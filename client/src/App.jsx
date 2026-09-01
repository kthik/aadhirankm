import { Navigate, Route, Routes } from 'react-router-dom';
import { useSession } from './lib/session.jsx';
import { Protected } from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import ForgotUid from './pages/ForgotUid.jsx';
import RegisterAcademy from './pages/RegisterAcademy.jsx';
import RegisterIndividual from './pages/RegisterIndividual.jsx';
import AcademyDashboard from './pages/AcademyDashboard.jsx';
import ParticipantDashboard from './pages/ParticipantDashboard.jsx';
import JudgeDashboard from './pages/JudgeDashboard.jsx';
import { AdminDashboard, SuperAdminDashboard } from './pages/StaffDashboards.jsx';

/** Sends a signed-in user to their role home, everyone else to the login screen. */
function Home() {
  const { user, loading, roles } = useSession();
  if (loading) return <div className="auth muted">Loading…</div>;
  return <Navigate to={user ? roles[user.role]?.home ?? '/login' : '/login'} replace />;
}

/** Renders a route only while its module is enabled in config. */
function ModuleRoute({ module, children }) {
  const { modules, loading } = useSession();
  if (loading) return <div className="auth muted">Loading…</div>;
  return modules[module] ? children : <Navigate to="/login" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/login" element={<Login />} />
      <Route path="/forgot-uid" element={<ForgotUid />} />
      <Route
        path="/register/academy"
        element={
          <ModuleRoute module="academyRegistration">
            <RegisterAcademy />
          </ModuleRoute>
        }
      />
      <Route
        path="/register/individual"
        element={
          <ModuleRoute module="individualRegistration">
            <RegisterIndividual />
          </ModuleRoute>
        }
      />

      <Route element={<Protected allow={['ACADEMY']} />}>
        <Route path="/academy" element={<AcademyDashboard />} />
      </Route>
      <Route element={<Protected allow={['INDIVIDUAL', 'ACADEMY_PARTICIPANT']} />}>
        <Route path="/participant" element={<ParticipantDashboard />} />
      </Route>
      <Route element={<Protected allow={['JUDGE']} />}>
        <Route path="/judge" element={<JudgeDashboard />} />
      </Route>
      <Route element={<Protected allow={['ADMIN', 'SUPER_ADMIN']} />}>
        <Route path="/admin" element={<AdminDashboard />} />
      </Route>
      <Route element={<Protected allow={['SUPER_ADMIN']} />}>
        <Route path="/super-admin" element={<SuperAdminDashboard />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
