import { Routes, Route, Navigate } from 'react-router'
import { AuthProvider } from './hooks/useAuth'
import AuthGuard from './components/AuthGuard'
import AdminGuard from './components/AdminGuard'
import Layout from './components/Layout'
import LoginPage from './pages/LoginPage'
import UploadPage from './pages/UploadPage'
import ImagesPage from './pages/ImagesPage'
import ProfilePage from './pages/ProfilePage'
import AdminUsersPage from './pages/AdminUsersPage'
import AdminUserImagesPage from './pages/AdminUserImagesPage'
import AdminProxyCachePage from './pages/AdminProxyCachePage'
import AdminProxyHostsPage from './pages/AdminProxyHostsPage'

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          element={
            <AuthGuard>
              <Layout />
            </AuthGuard>
          }
        >
          <Route path="/upload" element={<UploadPage />} />
          <Route path="/images" element={<ImagesPage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route
            path="/admin/users"
            element={
              <AdminGuard>
                <AdminUsersPage />
              </AdminGuard>
            }
          />
          <Route
            path="/admin/users/:id/images"
            element={
              <AdminGuard>
                <AdminUserImagesPage />
              </AdminGuard>
            }
          />
          <Route
            path="/admin/proxy/cache"
            element={
              <AdminGuard>
                <AdminProxyCachePage />
              </AdminGuard>
            }
          />
          <Route
            path="/admin/proxy/hosts"
            element={
              <AdminGuard>
                <AdminProxyHostsPage />
              </AdminGuard>
            }
          />
          <Route path="/" element={<Navigate to="/upload" replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/upload" replace />} />
      </Routes>
    </AuthProvider>
  )
}
