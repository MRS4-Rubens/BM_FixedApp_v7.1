import type { AppUser } from '@/lib/auth/ensure-app-user';
import type { CurrentBusiness } from '@/lib/auth/current-business';

export interface FakeUserRow extends Omit<AppUser, 'role'> {
  auth_user_id: string;
  role: AppUser['role'] | 'accountant';
}

export interface FakeState {
  userRow: FakeUserRow | null;
  businessRow: CurrentBusiness | null;
  sessionData: {
    user: {
      id: string;
      email: string | null;
      name: string | null;
    };
  } | null;
  selectCount: {
    users: number;
    businesses: number;
  };
  updateCount: {
    users: number;
  };
}

export function createInitialFakeState(): FakeState {
  return {
    userRow: {
      id: 'user-1',
      auth_user_id: 'auth-1',
      email: 'o@example.com',
      business_id: 'biz-1',
      role: 'owner',
      display_name: 'Owner User',
      notification_prefs: {},
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    },
    businessRow: {
      id: 'biz-1',
      legal_name: 'Acme Corp',
      trade_name: 'Acme',
      gstin: '29ABCDE1234F1Z5',
      pan: 'ABCDE1234F',
      registration_type: 'regular',
      address_line1: '123 Main St',
      address_line2: null,
      city: 'Bengaluru',
      state_code: '29',
      pincode: '560001',
      phone: '9876543210',
      email: 'biz@example.com',
      logo_storage_key: null,
      signature_storage_key: null,
      bank_account_name: null,
      bank_account_number: null,
      bank_ifsc: null,
      bank_name: null,
      invoice_terms: 'Standard terms',
      invoice_number_format: 'INV-{{FY}}-{{SEQ}}',
      invoice_display_prefs: {},
      default_invoice_template: 'template_1',
      credit_note_number_prefix: 'CN',
      payment_due_days: 30,
      nature_of_business: null,
      invoice_tagline: null,
      alternate_phone: null,
      default_gst_rate_type: 'exclusive',
      subscription_plan: 'free',
      subscription_status: 'active',
      trial_ends_at: null,
      subscription_activated_at: null,
      subscription_ends_at: null,
      active_utr_no: null,
      gst_filing_frequency: null,
      created_at: new Date('2026-01-01T00:00:00Z'),
      updated_at: new Date('2026-01-01T00:00:00Z'),
    },
    sessionData: {
      user: {
        id: 'auth-1',
        email: 'o@example.com',
        name: 'Owner',
      },
    },
    selectCount: {
      users: 0,
      businesses: 0,
    },
    updateCount: {
      users: 0,
    },
  };
}

export function createFakeDb(state: FakeState, schemaUsers: unknown, schemaBusinesses: unknown) {
  return {
    select: (cols?: unknown) => {
      void cols;
      return {
        from: (table: unknown) => ({
          where: (expr?: unknown) => {
            void expr;
            const execute = () => {
              if (table === schemaUsers || (table as { name?: string })?.name === 'users' || (table as { _?: { name?: string } })?._?.name === 'users') {
                state.selectCount.users++;
                return state.userRow ? [{ ...state.userRow }] : [];
              }
              if (table === schemaBusinesses || (table as { name?: string })?.name === 'businesses' || (table as { _?: { name?: string } })?._?.name === 'businesses') {
                state.selectCount.businesses++;
                return state.businessRow ? [{ ...state.businessRow }] : [];
              }
              return [];
            };

            return {
              limit: (n: number) => {
                const rows = execute();
                return Promise.resolve(rows.slice(0, n));
              },
              then: <TResult1 = unknown, TResult2 = never>(
                onfulfilled?: ((value: unknown[]) => TResult1 | PromiseLike<TResult1>) | null,
                onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
              ) => Promise.resolve(execute()).then(onfulfilled, onrejected),
              catch: <TResult = never>(
                onrejected?: ((reason: unknown) => TResult | PromiseLike<TResult>) | null
              ) => Promise.resolve(execute()).catch(onrejected),
              finally: (onfinally?: (() => void) | null) => Promise.resolve(execute()).finally(onfinally),
            };
          },
        }),
      };
    },
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (expr?: unknown) => {
          void expr;
          return {
            returning: async () => {
              if (table === schemaUsers || (table as { name?: string })?.name === 'users' || (table as { _?: { name?: string } })?._?.name === 'users') {
                state.updateCount.users++;
                if (state.userRow) {
                  Object.assign(state.userRow, values);
                  return [{ ...state.userRow }];
                }
              }
              return [];
            },
          };
        },
      }),
    }),
  };
}
