import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './components/ui';
import { USE_MOCKS } from './api';
import { useAuth } from './lib/auth';
import { Applications } from './pages/Applications';
import { CVs } from './pages/CVs';
import { Dashboard } from './pages/Dashboard';
import { JobDetail } from './pages/JobDetail';
import { Jobs } from './pages/Jobs';
import { Preferences } from './pages/Preferences';
import { Profile } from './pages/Profile';
import { Searches } from './pages/Searches';

export default function App() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="fullscreen-center">
        <span className="spinner" aria-label="Loading" />
      </div>
    );
  }

  return (
    <>
      {USE_MOCKS && <div className="mock-banner">Mock data mode: API calls are simulated in the browser.</div>}
      <Routes>
        <Route element={<AppLayout />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="jobs" element={<Jobs />} />
          <Route path="jobs/:id" element={<JobDetail />} />
          <Route path="applications" element={<Applications />} />
          <Route path="cvs" element={<CVs />} />
          <Route path="profile" element={<Profile />} />
          <Route path="preferences" element={<Preferences />} />
          <Route path="searches" element={<Searches />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
