"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { fmtInt } from "@/lib/format";
import { useI18n } from "@/lib/i18n";
import { previewFile, uploadFile, UploadFailure, type Preview, type Progress, type UploadOutcome } from "@/lib/upload-client";

const PW_KEY = "almithali-upload-pw";
type Phase = "idle" | "checking" | "ready" | "uploading" | "done" | "error";

const fmtSize = (b: number) => (b >= 1_048_576 ? `${(b / 1_048_576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const fmtDuration = (s: number) => (s >= 90 ? `${Math.round(s / 60)} min` : `${Math.max(1, Math.round(s))} s`);

/** Upload a sales export (CSV recommended for large months). New lines are added; nothing is deleted. */
export function UploadDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [password, setPassword] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [outcome, setOutcome] = useState<UploadOutcome | null>(null);
  const [rebuild, setRebuild] = useState<"idle" | "running" | "done" | "error">("idle");
  const [rebuildMsg, setRebuildMsg] = useState("");
  const stopRef = useRef(false);
  const startedAt = useRef(0);

  const uploading = phase === "uploading" || rebuild === "running";

  // Recalculates the dashboard totals from the stored lines (after rows were changed directly in the database).
  const runRebuild = async () => {
    setRebuild("running");
    setRebuildMsg("");
    try {
      const res = await fetch("/api/admin/rebuild", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setRebuild("error");
        setRebuildMsg(t(`upload.err.${body.error ?? "db_error"}`));
        return;
      }
      try {
        sessionStorage.setItem(PW_KEY, password);
      } catch {}
      setRebuild("done");
      setRebuildMsg(t("rebuild.done", { lines: fmtInt(body.lines), days: fmtInt(body.days), s: body.seconds }));
      router.refresh();
    } catch {
      setRebuild("error");
      setRebuildMsg(t("upload.err.network"));
    }
  };

  useEffect(() => {
    try {
      setPassword(sessionStorage.getItem(PW_KEY) ?? "");
    } catch {}
  }, []);

  // Close on Escape, except while an upload is running.
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && !uploading && onClose();
    document.addEventListener("keydown", k);
    return () => document.removeEventListener("keydown", k);
  }, [onClose, uploading]);

  // Warn before leaving the page in the middle of an upload.
  useEffect(() => {
    if (!uploading) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [uploading]);

  const choose = async (f: File) => {
    setFile(f);
    setPreview(null);
    setOutcome(null);
    setProgress(null);
    setError("");
    setPhase("checking");
    try {
      const p = await previewFile(f);
      setPreview(p);
      setPhase("ready");
    } catch {
      setError(t("upload.readFailed"));
      setPhase("error");
    }
  };

  const start = async () => {
    if (!file || !preview) return;
    stopRef.current = false;
    startedAt.current = Date.now();
    setError("");
    setPhase("uploading");
    setProgress({ rows: 0, inserted: 0, updated: 0, unchanged: 0, skipped: 0, ignored: 0, fraction: 0, batches: 0 });
    try {
      const res = await uploadFile(file, preview, password, setProgress, () => stopRef.current);
      try {
        sessionStorage.setItem(PW_KEY, password);
      } catch {}
      setOutcome(res);
      setPhase("done");
      router.refresh();
    } catch (e) {
      const code = e instanceof UploadFailure ? e.code : "network";
      setError(t(`upload.err.${code}`));
      setPhase("error");
      router.refresh(); // batches saved before the failure are already in the database
    }
  };

  const elapsed = (Date.now() - startedAt.current) / 1000;
  const eta = progress && progress.fraction > 0.02 ? (elapsed / progress.fraction) * (1 - progress.fraction) : null;
  const canStart = !!preview && preview.missingRequired.length === 0 && password.length > 0 && (phase === "ready" || phase === "error");

  return (
    <div className="drawer-backdrop modal-backdrop" onClick={() => !uploading && onClose()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="upload-title" onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <div>
            <div className="kicker">{t("upload.kicker")}</div>
            <h2 id="upload-title">{t("upload.title")}</h2>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={uploading} aria-label={t("drawer.close")}>
            ×
          </button>
        </header>
        <div className="modal-body">
          <p className="modal-lead">{t("upload.lead")}</p>

          <label className={`file-drop${uploading ? " is-disabled" : ""}`} htmlFor="upload-file">
            <input id="upload-file" type="file" accept=".csv,.xlsx,.xls" disabled={uploading} onChange={(e) => e.target.files?.[0] && choose(e.target.files[0])} />
            <span className="file-drop-title">{file ? file.name : t("upload.choose")}</span>
            <span className="file-drop-hint">{file ? <span className="num">{fmtSize(file.size)}</span> : t("upload.csvHint")}</span>
          </label>

          {phase === "checking" && <div className="notice notice-info">{t("upload.reading")}</div>}

          {preview && phase !== "checking" && (
            <div className="upload-summary">
              {preview.excelRows ? (
                <div>
                  <b className="num">{fmtInt(preview.excelRows.length)}</b> {t("upload.rowsInFile")}
                </div>
              ) : (
                <div>{t("upload.csvStream")}</div>
              )}
              {preview.kind === "excel" && file && file.size > 8 * 1_048_576 && <div className="notice notice-warn">{t("upload.bigExcel")}</div>}
              {preview.missingRequired.length > 0 && <div className="notice notice-bad">{t("upload.missingRequired", { cols: preview.missingRequired.join(", ") })}</div>}
              {preview.missingRequired.length === 0 && preview.missing.length > 0 && (
                <div className="notice notice-warn">{t("upload.missingOptional", { cols: preview.missing.join(", ") })}</div>
              )}
            </div>
          )}

          {progress && (phase === "uploading" || phase === "error" || phase === "done") && (
            <div className="progress-box" aria-live="polite">
              <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(progress.fraction * 100)}>
                <span className="progress-fill" style={{ width: `${Math.round(progress.fraction * 100)}%` }} />
              </div>
              <div className="progress-line">
                <span>
                  <b className="num">{Math.round(progress.fraction * 100)}%</b> · {t("upload.sent", { n: fmtInt(progress.rows) })}
                </span>
                {uploading && eta !== null && <span className="muted">{t("upload.eta", { t: fmtDuration(eta) })}</span>}
              </div>
              <div className="progress-stats">
                <span>
                  <b className="num">{fmtInt(progress.inserted)}</b> {t("upload.statNew")}
                </span>
                <span>
                  <b className="num">{fmtInt(progress.updated)}</b> {t("upload.statUpdated")}
                </span>
                <span>
                  <b className="num">{fmtInt(progress.unchanged)}</b> {t("upload.statSame")}
                </span>
                {progress.skipped > 0 && (
                  <span>
                    <b className="num">{fmtInt(progress.skipped)}</b> {t("upload.statSkipped")}
                  </span>
                )}
                {progress.ignored > 0 && (
                  <span title={t("upload.ignoredHint")}>
                    <b className="num">{fmtInt(progress.ignored)}</b> {t("upload.statIgnored")}
                  </span>
                )}
              </div>
            </div>
          )}

          {phase !== "done" && (
            <label className="field" htmlFor="upload-pw">
              <span>{t("upload.password")}</span>
              <input id="upload-pw" type="password" autoComplete="current-password" value={password} disabled={uploading} onChange={(e) => setPassword(e.target.value)} />
            </label>
          )}

          {error && (
            <div className="notice notice-bad" role="alert">
              {error} {progress && progress.rows > 0 && t("upload.partialKept", { n: fmtInt(progress.rows) })}
            </div>
          )}

          {outcome && (
            <div className={`notice ${outcome.stopped ? "notice-warn" : "notice-good"}`} role="status">
              <b>{outcome.stopped ? t("upload.stoppedTitle") : t("upload.done")}</b>{" "}
              {t("upload.doneDetail", {
                inserted: fmtInt(outcome.inserted),
                updated: fmtInt(outcome.updated),
                unchanged: fmtInt(outcome.unchanged),
                total: fmtInt(outcome.totalLines),
              })}
              {outcome.stopped && <> {t("upload.resumeHint")}</>}
            </div>
          )}

          <div className="modal-actions">
            {phase === "uploading" ? (
              <button className="btn btn-secondary" onClick={() => (stopRef.current = true)}>
                {t("upload.stop")}
              </button>
            ) : (
              <button className="btn btn-secondary" onClick={onClose}>
                {phase === "done" ? t("drawer.close") : t("upload.cancel")}
              </button>
            )}
            {phase !== "done" && (
              <button className="btn" disabled={!canStart || rebuild === "running"} onClick={start}>
                {phase === "uploading" ? t("upload.saving") : phase === "error" && progress ? t("upload.retry") : t("upload.start")}
              </button>
            )}
          </div>

          <details className="maintenance" open={rebuild !== "idle"}>
            <summary>{t("rebuild.title")}</summary>
            <p>{t("rebuild.lead")}</p>
            {rebuildMsg && (
              <div className={`notice ${rebuild === "done" ? "notice-good" : "notice-bad"}`} role="status">
                {rebuildMsg}
              </div>
            )}
            <button className="btn btn-secondary" disabled={!password || uploading} onClick={runRebuild}>
              {rebuild === "running" ? t("rebuild.running") : t("rebuild.button")}
            </button>
          </details>
        </div>
      </div>
    </div>
  );
}
