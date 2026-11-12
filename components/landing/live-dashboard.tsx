'use client'

import { useState, useEffect, useId, useRef } from 'react'
import Link from 'next/link'
import { Activity as ActivityIcon, ArrowUpRight, Bell, Clock, FilePlus, FileSpreadsheet, IndianRupee, MessageCircle, Pause, Play, RefreshCw, ShieldCheck, TrendingUp } from 'lucide-react'

export interface Activity {
  id: number
  icon: string
  color: 'emerald' | 'indigo' | 'amber' | 'violet'
  before: string
  strong: string
  after: string
  time: string
  desc: string
}

export const initialActivities: Activity[] = [
  { id: 1, icon: '#check-circle', color: 'emerald', before: 'Payment received ', strong: '₹42,000', after: '', time: '2 minutes ago', desc: 'Invoice #1284' },
  { id: 2, icon: '#invoice', color: 'indigo', before: 'Invoice ', strong: '#1292', after: ' sent via WhatsApp', time: '15 minutes ago', desc: 'Customer: KiranaKart' },
  { id: 3, icon: '#bell', color: 'amber', before: 'Follow-up reminder sent to ', strong: 'StyleDesk', after: '', time: '1 hour ago', desc: 'Payment overdue' },
  { id: 4, icon: '#thumbs-up', color: 'violet', before: 'New customer ', strong: 'AgroTrade', after: ' onboarded', time: '2 hours ago', desc: 'Self signup' }
]

export const dummyActivities = [
  { icon: '#check-circle', color: 'emerald', before: 'Payment received ', strong: '₹18,500', after: '', time: 'Just now', desc: 'Invoice #1295' },
  { icon: '#invoice', color: 'indigo', before: 'Invoice ', strong: '#1296', after: ' generated', time: 'Just now', desc: 'Customer: MediSupply' },
  { icon: '#bell', color: 'amber', before: 'Follow-up sent to ', strong: 'ShopSwift', after: '', time: 'Just now', desc: 'Pending ₹22,000' },
  { icon: '#thumbs-up', color: 'violet', before: 'New customer ', strong: 'UrbanD2C', after: ' added', time: 'Just now', desc: 'Self registration' }
] as const

const baseRevenuePoints = [
  { x: 0, y: 55 }, { x: 50, y: 48 }, { x: 100, y: 52 }, { x: 150, y: 38 },
  { x: 200, y: 42 }, { x: 250, y: 28 }, { x: 300, y: 35 }, { x: 350, y: 20 },
  { x: 400, y: 25 }, { x: 450, y: 15 }, { x: 500, y: 18 }, { x: 550, y: 8 },
  { x: 600, y: 10 }
]

const activityColors = {
  emerald: 'bg-emerald-50 text-emerald-700',
  indigo: 'bg-indigo-50 text-indigo-700',
  amber: 'bg-amber-50 text-amber-800',
  violet: 'bg-violet-50 text-violet-700',
}
const quickActions = [
  { label: 'New invoice', href: '/invoices/new', icon: FilePlus },
  { label: 'ITR export', href: '/reports', icon: FileSpreadsheet },
  { label: 'Share from invoices', href: '/invoices', icon: MessageCircle },
]
const controlStyle = 'inline-flex min-h-10 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-sm font-semibold text-slate-700 transition-colors hover:border-teal-200 hover:bg-teal-50 hover:text-teal-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700'

export function LiveDashboard() {
  const containerRef = useRef<HTMLElement | null>(null)
  const [isInView, setIsInView] = useState(false)
  const [isPageVisible, setIsPageVisible] = useState(true)
  const [paused, setPaused] = useState(false)
  const isActive = isInView && isPageVisible && !paused
  const areaGradient = useId()
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => {
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current)
  }, [])

  useEffect(() => {
    const el = containerRef.current
    if (!el || typeof IntersectionObserver === 'undefined') {
      setIsInView(true)
      return
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        setIsInView(Boolean(entry?.isIntersecting))
      },
      { threshold: 0.1 }
    )
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsPageVisible(document.visibilityState === 'visible')
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [])

  // Last updated timestamp state
  const [lastRefresh, setLastRefresh] = useState<number>(() => Date.now())
  const [relativeTime, setRelativeTime] = useState('Just now')
  const [refreshSpin, setRefreshSpin] = useState(false)

  // KPI States
  const [invoicesToday, setInvoicesToday] = useState(128)
  const [revenue, setRevenue] = useState(4.2)
  const [followups, setFollowups] = useState(14)
  const [weekRevenue, setWeekRevenue] = useState(8.9)

  // Animation Pulse States (for trigger visual cue)
  const [pulseInvoices, setPulseInvoices] = useState(false)
  const [pulseRevenue, setPulseRevenue] = useState(false)
  const [pulseFollowups, setPulseFollowups] = useState(false)
  const [pulseWeekRevenue, setPulseWeekRevenue] = useState(false)

  // SVG Chart points state
  const [chartPoints, setChartPoints] = useState(baseRevenuePoints)

  // Activity feed state
  const [activities, setActivities] = useState<Activity[]>(initialActivities)
  const [activityIdCounter, setActivityIdCounter] = useState(5)

  // Refresh dynamic relative time
  useEffect(() => {
    if (!isActive) return
    const interval = setInterval(() => {
      const diffSeconds = Math.floor((Date.now() - lastRefresh) / 1000)
      if (diffSeconds < 10) {
        setRelativeTime('Just now')
      } else if (diffSeconds < 60) {
        setRelativeTime(`${diffSeconds}s ago`)
      } else {
        setRelativeTime(`${Math.floor(diffSeconds / 60)} min ago`)
      }
    }, 5000)
    return () => clearInterval(interval)
  }, [lastRefresh, isActive])

  // Random-walk for KPIs
  useEffect(() => {
    if (!isActive) return
    const kpiInterval = setInterval(() => {
      // Invoices Today random walk
      if (Math.random() < 0.3) {
        const change = Math.floor(Math.random() * 3) - 1 // -1, 0, +1
        setInvoicesToday(prev => Math.max(0, prev + change))
        setPulseInvoices(true)
        setTimeout(() => setPulseInvoices(false), 600)
      }
      // Revenue random walk
      if (Math.random() < 0.3) {
        const change = (Math.random() * 0.2) - 0.1 // -0.1 to +0.1
        setRevenue(prev => Math.max(0, parseFloat((prev + change).toFixed(1))))
        setPulseRevenue(true)
        setTimeout(() => setPulseRevenue(false), 600)
      }
      // Follow-ups random walk
      if (Math.random() < 0.4) {
        const change = Math.floor(Math.random() * 3) - 1
        setFollowups(prev => Math.max(0, prev + change))
        setPulseFollowups(true)
        setTimeout(() => setPulseFollowups(false), 600)
      }
      // Weekly Revenue random walk
      if (Math.random() < 0.3) {
        const change = (Math.random() * 0.3) - 0.15
        setWeekRevenue(prev => Math.max(0, parseFloat((prev + change).toFixed(1))))
        setPulseWeekRevenue(true)
        setTimeout(() => setPulseWeekRevenue(false), 600)
      }
    }, 2500)

    return () => clearInterval(kpiInterval)
  }, [isActive])

  // Random-walk for SVG Sparkline Chart
  const varyChartPoints = () => {
    setChartPoints(prev =>
      prev.map((p, i) => ({
        x: p.x,
        y: Math.max(2, Math.min(78, p.y + (Math.random() * 6 - 3) * (i < 12 ? 1 : 0)))
      }))
    )
  }

  useEffect(() => {
    if (!isActive) return
    const chartInterval = setInterval(varyChartPoints, 3000)
    return () => clearInterval(chartInterval)
  }, [isActive])

  // Insert dummy activities
  useEffect(() => {
    if (!isActive) return
    const activityInterval = setInterval(() => {
      const dummy = dummyActivities[Math.floor(Math.random() * dummyActivities.length)]
      const newAct: Activity = {
        id: activityIdCounter,
        icon: dummy.icon,
        color: dummy.color,
        before: dummy.before,
        strong: dummy.strong,
        after: dummy.after,
        time: 'Just now',
        desc: dummy.desc
      }
      setActivityIdCounter(prev => prev + 1)
      setActivities(prev => [newAct, ...prev.filter(activity => activity.strong !== newAct.strong)].slice(0, 4))
    }, 8000)

    return () => clearInterval(activityInterval)
  }, [activityIdCounter, isActive])

  // Handle manual refresh button click
  const handleRefresh = () => {
    setRefreshSpin(true)
    setLastRefresh(Date.now())
    setRelativeTime('Just now')

    // Vary values instantly
    varyChartPoints()
    setInvoicesToday(prev => Math.max(0, prev + Math.floor(Math.random() * 3) - 1))
    setRevenue(prev => Math.max(0, parseFloat((prev + (Math.random() * 0.2 - 0.1)).toFixed(1))))
    setFollowups(prev => Math.max(0, prev + Math.floor(Math.random() * 3) - 1))
    setWeekRevenue(prev => Math.max(0, parseFloat((prev + (Math.random() * 0.3 - 0.15)).toFixed(1))))

    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => {
      setRefreshSpin(false)
      refreshTimer.current = null
    }, 600)
  }

  const linePoints = chartPoints.map(({ x, y }) => `${x},${y}`).join(' ')
  const metrics = [
    { label: 'Invoices today', value: invoicesToday, icon: FilePlus, pulse: pulseInvoices },
    { label: 'Revenue today', value: `₹${revenue.toFixed(1)}L`, icon: IndianRupee, pulse: pulseRevenue },
    { label: 'Compliance', value: 'GST ready', icon: ShieldCheck, color: 'text-emerald-700' },
    { label: 'Follow-ups', value: followups, icon: Bell, pulse: pulseFollowups },
    { label: 'Revenue this week', value: `₹${weekRevenue.toFixed(1)}L`, icon: TrendingUp, pulse: pulseWeekRevenue },
  ]

  return (
    <section
      ref={containerRef}
      id="dashboard"
      aria-labelledby="demo-heading"
      className="scroll-mt-24 border-y border-teal-100/80 bg-linear-to-b from-white to-[#eff7f5] px-5 py-8 sm:px-8 sm:py-10"
    >
      <div className="mx-auto max-w-6xl">
        <div className="mb-5 text-center sm:mb-6">
          <p className="mb-2 inline-flex items-center gap-1.5 rounded-full border border-teal-100 bg-teal-50 px-2.5 py-1 text-xs font-semibold text-teal-800">
            <ActivityIcon aria-hidden="true" className="size-3.5" />
            Live demo
          </p>
          <h2 id="demo-heading" className="text-3xl font-bold leading-tight tracking-tight text-slate-950 sm:text-4xl">
            See Invoice BizFolio <span className="text-teal-800">in action</span>
          </h2>
          <p className="mx-auto mt-2 max-w-xl text-pretty text-sm leading-relaxed text-slate-700 sm:text-base">
            Watch sample invoices, revenue, and activity update in real time.
          </p>
        </div>

        <div className="rounded-3xl border border-teal-100 bg-white p-3 shadow-[0_20px_55px_-40px_#134e4a45] sm:p-5">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2.5 border-b border-slate-200 pb-3 sm:mb-4">
            <div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <h3 className="text-lg font-bold tracking-tight text-slate-950 sm:text-xl">Business snapshot</h3>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
                  Sample data
                </span>
              </div>
              <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-600">
                <Clock aria-hidden="true" className="size-3.5" />
                Last refreshed: {relativeTime.toLowerCase()}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span role="status" className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${paused ? 'bg-slate-100 text-slate-700' : 'bg-emerald-50 text-emerald-800'}`}>
                <span aria-hidden="true" className={`size-1.5 rounded-full ${paused ? 'bg-slate-500' : 'bg-emerald-600'}`} />
                {paused ? 'Paused' : 'Live'}
              </span>
              <button type="button" onClick={() => setPaused(value => !value)} className={controlStyle}>
                {paused ? <Play aria-hidden="true" className="size-3.5" /> : <Pause aria-hidden="true" className="size-3.5" />}
                {paused ? 'Resume' : 'Pause'}
              </button>
              <button type="button" onClick={handleRefresh} className={controlStyle}>
                <RefreshCw aria-hidden="true" className={`size-3.5 motion-safe:transition-transform motion-safe:duration-500 ${refreshSpin ? 'motion-safe:rotate-180' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          <dl className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5 sm:mb-4 sm:gap-2.5">
            {metrics.map(({ label, value, icon: Icon, color, pulse }, index) => (
              <div key={label} className={`min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 px-2.5 py-2 sm:px-3 sm:py-2.5 ${index === metrics.length - 1 ? 'col-span-2 md:col-span-1' : ''}`}>
                <dt className="flex items-center gap-1.5 text-xs font-medium leading-snug text-slate-700 sm:text-sm">
                  <Icon aria-hidden="true" className={`size-3.5 shrink-0 ${color ?? 'text-teal-700'}`} />
                  {label}
                </dt>
                <dd className={`mt-1 text-xl font-bold leading-tight tracking-tight tabular-nums transition-colors sm:text-2xl ${color ?? (pulse ? 'text-teal-800' : 'text-slate-950')}`}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>

          <div className="grid gap-3 lg:grid-cols-[1.25fr_1fr] sm:gap-4">
            <figure className="flex min-w-0 flex-col rounded-2xl border border-teal-100 bg-linear-to-b from-teal-50/70 to-white p-3 sm:p-4">
              <figcaption className="flex flex-wrap items-baseline justify-between gap-1">
                <span className="text-base font-bold text-slate-950">Revenue trend</span>
                <span className="text-xs font-medium text-slate-600">Today</span>
              </figcaption>
              <svg aria-hidden="true" viewBox="0 0 600 80" preserveAspectRatio="none" className="mt-3 min-h-24 w-full flex-1 sm:min-h-32">
                <defs>
                  <linearGradient id={areaGradient} x1="0%" y1="0%" x2="0%" y2="100%">
                    <stop offset="0%" stopColor="#0d9488" stopOpacity="0.28" />
                    <stop offset="100%" stopColor="#0d9488" stopOpacity="0.02" />
                  </linearGradient>
                </defs>
                {[18, 38, 58, 78].map(y => (
                  <line key={y} x1="0" y1={y} x2="600" y2={y} stroke="#b8dcd6" strokeWidth="1" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
                ))}
                <polygon fill={`url(#${areaGradient})`} points={`0,80 ${linePoints} 600,80`} />
                <polyline fill="none" stroke="#0f766e" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" points={linePoints} />
              </svg>
              <div aria-hidden="true" className="mt-2 flex justify-between text-xs text-slate-600">
                <span>8 AM</span>
                <span>10 AM</span>
                <span>Noon</span>
                <span>2 PM</span>
                <span>4 PM</span>
                <span>6 PM</span>
                <span>Now</span>
              </div>
            </figure>

            <div className="min-w-0 rounded-2xl border border-slate-200 p-3 sm:p-4">
              <h4 className="mb-1 text-base font-bold text-slate-950">Recent activity</h4>
              <ul id="activityFeed" className="divide-y divide-slate-100">
                {activities.map(activity => (
                  <li key={activity.id} className="flex items-center gap-2 py-1.5 text-sm leading-snug">
                    <span className={`grid size-7 shrink-0 place-items-center rounded-lg ${activityColors[activity.color]}`}>
                      <svg aria-hidden="true" className="size-3.5">
                        <use href={activity.icon} />
                      </svg>
                    </span>
                    <div className="min-w-0">
                      <p className="text-zinc-700">{activity.before}<span className="font-semibold text-zinc-800">{activity.strong}</span>{activity.after}</p>
                      <p className="mt-0.5 text-xs text-slate-600">{activity.desc} · {activity.time}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="mt-3 grid gap-2.5 sm:mt-4 sm:gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-teal-100 bg-teal-50/60 p-2.5">
              <h4 className="basis-full px-1 text-sm font-bold text-teal-950 sm:basis-auto">Quick actions</h4>
              {quickActions.map(({ label, href, icon: Icon }) => (
                <Link key={href} href={href} className={controlStyle}>
                  <Icon aria-hidden="true" className="size-3.5 text-teal-800" />
                  {label}
                  <ArrowUpRight aria-hidden="true" className="size-3 text-teal-800" />
                </Link>
              ))}
            </div>
            <dl className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-xl border border-amber-200/70 bg-amber-50 px-3 py-2.5 lg:items-center">
              <dt className="text-sm font-semibold text-amber-900">Payment due</dt>
              <dd className="text-lg font-bold leading-tight tabular-nums text-slate-950">₹1.2L</dd>
              <dd className="text-xs text-slate-700">6 invoices pending</dd>
            </dl>
          </div>
        </div>
      </div>
    </section>
  )
}
