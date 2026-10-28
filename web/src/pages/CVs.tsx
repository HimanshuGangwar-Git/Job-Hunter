import { useEffect, useRef, useState } from 'react';
import { deleteCv, listCvs, setPrimaryCv, uploadCv } from '../api';
import { EmptyState, ErrorBanner, Panel, Spinner } from '../components/ui';
import { formatDate } from '../lib/format';
import type { CvDocument } from '../types';

const ACCEPTED = '.pdf,.docx';
const MAX_BYTES = 5 * 1024 * 1024;

export function CVs() {
  const [cvs, setCvs] = useState<CvDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    listCvs()
      .then(setCvs)
      .catch((err: unknown) => setError(err))
      .finally(() => setLoading(false));
  }, []);

  async function onFile(file: File | undefined) {
    if (!file) return;
    setError(null);
    setNotice(null);
    if (file.size > MAX_BYTES) {
      setError(new Error('CV files must be 5 MB or smaller.'));
      return;
    }
    setUploading(true);
    try {
      const cv = await uploadCv(file);
      setCvs((prev) => [...prev, cv]);
      setNotice(`${cv.fileName} uploaded and parsed. Skills were added to your profile.`);
    } catch (err) {
      setError(err);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function makePrimary(id: string) {
    try {
      await setPrimaryCv(id);
      setCvs((prev) => prev.map((cv) => ({ ...cv, isPrimary: cv.id === id })));
    } catch (err) {
      setError(err);
    }
  }

  async function remove(cv: CvDocument) {
    if (!window.confirm(`Delete ${cv.fileName}? This cannot be undone.`)) return;
    try {
      await deleteCv(cv.id);
      setCvs((prev) => prev.filter((x) => x.id !== cv.id));
    } catch (err) {
      setError(err);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <h1>CVs</h1>
          <p>Upload several versions. Each job is matched against all of them and the best fit is used for tailoring.</p>
        </div>
        <div className="row">
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPTED}
            hidden
            id="cv-upload"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <label htmlFor="cv-upload" className={`btn btn-primary${uploading ? ' disabled' : ''}`} style={{ cursor: 'pointer' }}>
            {uploading ? 'Uploading…' : 'Upload CV'}
          </label>
        </div>
      </div>

      <ErrorBanner error={error} />
      {notice && <div className="banner banner-success">{notice}</div>}

      <Panel>
        {loading ? (
          <Spinner label="Loading CVs" />
        ) : cvs.length === 0 ? (
          <EmptyState title="No CVs yet" body="Upload a PDF or DOCX. We extract your skills, experience and education from it." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>File</th>
                  <th>Uploaded</th>
                  <th>Skills found</th>
                  <th>Words</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {cvs.map((cv) => (
                  <tr key={cv.id}>
                    <td className="mono small">{cv.fileName}</td>
                    <td className="small">{formatDate(cv.uploadedAt)}</td>
                    <td>{cv.skillCount}</td>
                    <td>{cv.wordCount}</td>
                    <td>{cv.isPrimary ? <span className="badge badge-accent">Primary</span> : <span className="muted small">Secondary</span>}</td>
                    <td>
                      <div className="row" style={{ justifyContent: 'flex-end' }}>
                        {!cv.isPrimary && (
                          <button className="btn btn-sm" onClick={() => makePrimary(cv.id)}>
                            Set as primary
                          </button>
                        )}
                        <button className="btn btn-sm btn-danger" onClick={() => remove(cv)}>
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      <p className="muted small">
        Accepted formats: PDF and DOCX up to 5 MB. Files are stored on the server and only used to build your profile and tailored versions.
      </p>
    </>
  );
}
