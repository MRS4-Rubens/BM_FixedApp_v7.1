import type { Metadata } from 'next'
import { CustomerForm } from '@/components/app/customers/customer-form'
import { getCurrentAppUser } from '@/lib/auth/session'
import { redirectReadOnlyRole } from '@/lib/auth/page-guards'
import { getCurrentBusiness } from '@/lib/auth/current-business'
import { redirect } from 'next/navigation'

export const metadata: Metadata = { title: 'Add Customer' }

export default async function NewCustomerPage() {
  const appUser = await getCurrentAppUser()
  if (!appUser) {
    redirect('/login')
  }

  if (!appUser.business_id) {
    redirect('/settings')
  }
  redirectReadOnlyRole(appUser.role, '/customers')

  const business = await getCurrentBusiness()
  const sellerStateCode = business?.state_code || ''

  return (
    <div className="w-full space-y-6">
      <div className="flex flex-col gap-1 shrink-0">
        <h1 className="text-3xl font-extrabold tracking-tight text-foreground font-heading uppercase">
          ADD CUSTOMER
        </h1>
        <p className="text-sm font-semibold text-muted-foreground leading-relaxed max-w-[315px] sm:text-justify sm:[text-align-last:justify]">
          Effortlessly Track, Organize, Maintain, and <br />
          Add a Customer to Your Directory
        </p>
      </div>

      <CustomerForm sellerStateCode={sellerStateCode} />
    </div>
  )
}
