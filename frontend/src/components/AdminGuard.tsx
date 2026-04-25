import { type ReactNode } from "react";
import { Navigate } from "react-router";
import { useAuth } from "../hooks/useAuth";

export default function AdminGuard({ children }: { children: ReactNode }) {
  const { loaded, isAdmin } = useAuth();

  if (!loaded) return null;
  if (!isAdmin) return <Navigate to="/upload" replace />;
  return <>{children}</>;
}
