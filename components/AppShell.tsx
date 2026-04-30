import { Sidebar } from "./Sidebar";

/**
 * Two-column layout used across all interactive pages: persistent sidebar on
 * the left, scrollable main pane on the right. Pages render their own header
 * + content inside `children`.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full overflow-hidden">
      <Sidebar />
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">{children}</main>
    </div>
  );
}
