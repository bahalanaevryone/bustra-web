import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
export const supabase = url && key ? createClient(url, key) : null
export function requireClient() {
  if (!supabase) throw new Error('Supabase is not configured. Add the public project settings to .env.local.')
  return supabase
}
export async function rpc<T = undefined>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await requireClient().rpc(name, args)
  if (error) throw error
  return data as T
}
