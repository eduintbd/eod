import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  Upload,
  Users,
  FileText,
  TrendingUp,
  Shield,
  Bell,
  Settings,
  LogOut,
} from 'lucide-react';
import { useAuth } from '@/hooks/useAuth';

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
  { to: '/market', icon: TrendingUp, label: 'Market Data' },
  { to: '/import', icon: Upload, label: 'Import Data' },
  { to: '/clients', icon: Users, label: 'Clients' },
  { to: '/audit', icon: FileText, label: 'Import Audit' },
  { to: '/risk', icon: Shield, label: 'Risk & Margin' },
  { to: '/alerts', icon: Bell, label: 'Margin Alerts' },
  { to: '/settings', icon: Settings, label: 'Settings' },
];

export function Sidebar() {
  const { signOut } = useAuth();

  return (
    <aside className="w-64 bg-primary text-primary-foreground flex flex-col min-h-screen">
      <div className="p-6 border-b border-white/10">
        <h1 className="text-lg font-bold">UCB Stock</h1>
        <p className="text-xs text-white/60 mt-1">CRM & Risk Platform</p>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navItems.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-white/15 text-white font-medium'
                  : 'text-white/70 hover:bg-white/10 hover:text-white'
              }`
            }
          >
            <Icon size={18} />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-4 border-t border-white/10">
        <button
          onClick={() => signOut()}
          className="flex items-center gap-3 px-3 py-2 text-sm text-white/70 hover:text-white hover:bg-white/10 rounded-md w-full transition-colors"
        >
          <LogOut size={18} />
          Sign Out
        </button>
      </div>
    </aside>
  );
}
