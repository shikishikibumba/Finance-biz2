import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useTheme } from "@/contexts/ThemeContext";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  LayoutDashboard, Users, Truck, Package, ShoppingCart,
  FileText, Receipt, CreditCard, BarChart3, LineChart, RotateCcw, History, LogOut, Menu,
  Sun, Moon, Settings as SettingsIcon, Send,
} from "lucide-react";

const NAV_ITEMS = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/customers", icon: Users, label: "Customers" },
  { to: "/suppliers", icon: Truck, label: "Suppliers" },
  { to: "/products", icon: Package, label: "Products" },
  { to: "/orders", icon: ShoppingCart, label: "Orders" },
  { to: "/purchases", icon: FileText, label: "Purchases" },
  { to: "/invoices", icon: Receipt, label: "Invoices" },
  { to: "/payments", icon: CreditCard, label: "Payments" },
  { to: "/returns", icon: RotateCcw, label: "Returns" },
  { to: "/delivery", icon: Send, label: "Delivery" },
  { to: "/analytics", icon: LineChart, label: "Analytics" },
  { to: "/reports", icon: BarChart3, label: "Reports" },
  { to: "/migration", icon: History, label: "Migration" },
  { to: "/settings", icon: SettingsIcon, label: "Settings" },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const { theme, toggle: toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate("/login");
  };

  const SidebarContent = () => (
    <>
      <div className="p-4 border-b border-white/10">
        <h1 className="text-lg font-semibold tracking-tight text-white" style={{ fontFamily: 'Outfit, sans-serif' }}>
          Commerical Trading
        </h1>
        <p className="text-xs text-white/50 mt-0.5">Business Management</p>
      </div>
      <ScrollArea className="flex-1 py-3">
        <nav className="px-2 space-y-0.5">
          {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === "/"}
              onClick={() => setSidebarOpen(false)}
              className={({ isActive }) =>
                `sidebar-link ${isActive ? "active bg-white/15 text-white" : "text-white/70 hover:text-white"}`
              }
              data-testid={`nav-${label.toLowerCase()}`}
            >
              <Icon size={18} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
      </ScrollArea>
      <div className="p-3 border-t border-white/10">
        <div className="text-xs text-white/50 mb-2 px-3 truncate">{user?.name || user?.email}</div>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start text-white/70 hover:text-white hover:bg-white/10 gap-2"
          onClick={handleLogout}
          data-testid="logout-button"
        >
          <LogOut size={16} /> Logout
        </Button>
      </div>
    </>
  );

  return (
    <div className="flex h-screen overflow-hidden bg-[hsl(var(--surface-muted))]">
      {/* Desktop Sidebar */}
      <aside className="hidden lg:flex lg:flex-col lg:w-56 bg-[#0F172A] flex-shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile Sidebar Overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="fixed inset-0 bg-black/50" onClick={() => setSidebarOpen(false)} />
          <aside className="fixed left-0 top-0 bottom-0 w-56 bg-[#0F172A] flex flex-col z-50">
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Top Bar */}
        <header className="h-14 bg-[hsl(var(--card))] border-b border-[hsl(var(--border))] flex items-center px-4 gap-3 flex-shrink-0 no-print">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={() => setSidebarOpen(true)}
            data-testid="mobile-menu-button"
          >
            <Menu size={20} />
          </Button>
          <div className="flex-1" />
          <Button
            variant="ghost"
            size="icon"
            onClick={toggleTheme}
            className="rounded-full"
            aria-label="Toggle theme"
            data-testid="theme-toggle-button"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </Button>
          <span className="text-sm text-muted-foreground hidden sm:inline">{user?.email}</span>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-auto">
          <div className="p-4 sm:p-6 lg:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
