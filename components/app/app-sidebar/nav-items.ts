import {
  LayoutDashboard,
  FileText,
  Users,
  Package,
  BarChart3,
  Settings,
  ShieldCheck,
} from 'lucide-react'

export interface NavItem {
  label: string
  icon: React.ElementType
  href: string
  color: {
    activeGradient: string
    inactiveBg: string
    inactiveText: string
    inactiveBorder: string
  }
}

export const mainNav: NavItem[] = [
  {
    label: 'Dashboard',
    icon: LayoutDashboard,
    href: '/dashboard',
    color: {
      activeGradient: 'bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30',
      inactiveBg: 'bg-indigo-500/10',
      inactiveText: 'text-indigo-600 dark:text-indigo-400',
      inactiveBorder: 'border-indigo-500/20',
    },
  },
  {
    label: 'Invoices',
    icon: FileText,
    href: '/invoices',
    color: {
      activeGradient: 'bg-gradient-to-br from-blue-500 to-sky-600 text-white shadow-md shadow-blue-500/30',
      inactiveBg: 'bg-blue-500/10',
      inactiveText: 'text-blue-600 dark:text-blue-400',
      inactiveBorder: 'border-blue-500/20',
    },
  },
  {
    label: 'Customers',
    icon: Users,
    href: '/customers',
    color: {
      activeGradient: 'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-500/30',
      inactiveBg: 'bg-emerald-500/10',
      inactiveText: 'text-emerald-700 dark:text-emerald-400',
      inactiveBorder: 'border-emerald-500/20',
    },
  },
  {
    label: 'Products',
    icon: Package,
    href: '/products',
    color: {
      activeGradient: 'bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-md shadow-amber-500/30',
      inactiveBg: 'bg-amber-500/10',
      inactiveText: 'text-amber-800 dark:text-amber-400',
      inactiveBorder: 'border-amber-500/20',
    },
  },
  {
    label: 'Reports',
    icon: BarChart3,
    href: '/reports',
    color: {
      activeGradient: 'bg-gradient-to-br from-purple-500 to-violet-600 text-white shadow-md shadow-purple-500/30',
      inactiveBg: 'bg-purple-500/10',
      inactiveText: 'text-purple-600 dark:text-purple-400',
      inactiveBorder: 'border-purple-500/20',
    },
  },
]

export const accountNav: NavItem[] = [
  {
    label: 'Settings',
    icon: Settings,
    href: '/settings',
    color: {
      activeGradient: 'bg-gradient-to-br from-slate-600 to-slate-800 text-white shadow-md shadow-slate-600/30',
      inactiveBg: 'bg-slate-500/10',
      inactiveText: 'text-slate-600 dark:text-slate-400',
      inactiveBorder: 'border-slate-500/20',
    },
  },
]

export const adminNavItem: NavItem = {
  label: 'Admin Console',
  icon: ShieldCheck,
  href: '/admin',
  color: {
    activeGradient: 'bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-md shadow-rose-500/30',
    inactiveBg: 'bg-rose-500/10',
    inactiveText: 'text-rose-600 dark:text-rose-400',
    inactiveBorder: 'border-rose-500/20',
  },
}

