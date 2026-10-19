import Link from 'next/link'
import { cn } from '@/lib/utils'

interface AppBrandLogoProps {
  href?: string
  isCollapsed?: boolean
  className?: string
}

export function AppBrandLogo({
  href = '/dashboard',
  isCollapsed = false,
  className,
}: AppBrandLogoProps) {
  return (
    <Link
      href={href}
      className={cn(
        'flex items-center gap-2 group focus-visible:outline-none select-none',
        className
      )}
      aria-label="Bill Matrix"
    >
      <div className="flex size-8.5 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 via-indigo-600 to-violet-600 font-extrabold text-white text-base shadow-[0_4px_14px_rgba(99,102,241,0.35)] border border-white/20 transition-transform duration-300 hover:rotate-[-4deg] hover:scale-105">
        B
      </div>

      <div
        className={cn(
          'flex flex-col leading-tight transition-all duration-300 ease-in-out origin-left overflow-hidden whitespace-nowrap',
          isCollapsed ? 'opacity-0 max-w-0' : 'opacity-100 max-w-40'
        )}
      >
        <div className="flex items-center gap-1">
          <span className="text-[14.5px] font-black tracking-tight text-foreground">
            Bill
          </span>
          <span className="text-[14.5px] font-black tracking-tight bg-gradient-to-r from-indigo-500 via-purple-500 to-violet-600 bg-clip-text text-transparent">
            Matrix
          </span>
        </div>
        <span className="text-[9px] font-extrabold text-muted-foreground/80 uppercase tracking-[0.16em] mt-0.5">
          GST Invoicing Suite
        </span>
      </div>
    </Link>
  )
}
