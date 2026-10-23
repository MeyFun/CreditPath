import { Navigate, Route, Routes } from "react-router-dom";
import { RequireRole, homeForRole, useAuth } from "./auth";
import { AppShell } from "./components/Shell";
import { FullPageLoader } from "./components/ui";
import AdminApplications from "./pages/AdminApplications";
import AdminAudit from "./pages/AdminAudit";
import AdminDictionaries from "./pages/AdminDictionaries";
import AdminUsers from "./pages/AdminUsers";
import ApplicationPage from "./pages/ApplicationPage";
import ApplicationsPage from "./pages/ApplicationsPage";
import AuthPage from "./pages/AuthPage";
import CompanyPage from "./pages/CompanyPage";
import DashboardPage from "./pages/DashboardPage";
import HomePage from "./pages/HomePage";
import NewApplicationPage from "./pages/NewApplicationPage";
import NotificationsPage from "./pages/NotificationsPage";
import ProductsPage from "./pages/ProductsPage";
import ResultPage from "./pages/ResultPage";
import StaffApplicationPage from "./pages/StaffApplicationPage";
import StaffQueuePage from "./pages/StaffQueuePage";

function RoleRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  return <Navigate to={user ? homeForRole(user) : "/"} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<AuthPage />} />
      <Route path="/register" element={<AuthPage initialTab="register" />} />
      <Route path="/app" element={<RequireRole roles={["client", "employee", "admin"]}><AppShell role="client" /></RequireRole>}>
        <Route index element={<DashboardPage />} />
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="applications/new" element={<NewApplicationPage />} />
        <Route path="applications/:id" element={<ApplicationPage />} />
        <Route path="applications/:id/result" element={<ResultPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="company" element={<CompanyPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
      </Route>
      <Route path="/staff" element={<RequireRole roles={["employee"]}><AppShell role="employee" /></RequireRole>}>
        <Route index element={<StaffQueuePage />} />
        <Route path="applications/:id" element={<StaffApplicationPage />} />
        <Route path="notifications" element={<NotificationsPage />} />
      </Route>
      <Route path="/admin" element={<RequireRole roles={["admin"]}><AppShell role="admin" /></RequireRole>}>
        <Route index element={<Navigate to="/admin/users" replace />} />
        <Route path="users" element={<AdminUsers />} />
        <Route path="applications" element={<AdminApplications />} />
        <Route path="applications/:id" element={<AdminApplications />} />
        <Route path="audit" element={<AdminAudit />} />
        <Route path="dictionaries" element={<AdminDictionaries />} />
        <Route path="notifications" element={<NotificationsPage />} />
      </Route>
      <Route path="*" element={<RoleRedirect />} />
    </Routes>
  );
}
