import { createClient } from "@supabase/supabase-js";
import { Investment, UserProfile } from "../types";

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || "https://zcuvlpgtodiropcbneox.supabase.co";
const SUPABASE_ANON_KEY =
  import.meta.env.VITE_SUPABASE_ANON_KEY ||
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpjdXZscGd0b2Rpcm9wY2JuZW94Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA5ODc3NzcsImV4cCI6MjA4NjU2Mzc3N30.dKYoM3_BhrhpBNOZLEniI37XDLjvymVw-qxvH-J8DAg";

const TABLE = "portfolio_state";
const STATE_ID = 1;

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export type PortfolioState = {
  investments: Investment[];
  profile: UserProfile;
};

export const loadPortfolioState = async (): Promise<PortfolioState | null> => {
  const { data, error } = await supabase
    .from(TABLE)
    .select("investments, profile")
    .eq("id", STATE_ID)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    investments: Array.isArray(data.investments) ? (data.investments as Investment[]) : [],
    profile: (data.profile || { name: "Investor", currency: "₹" }) as UserProfile,
  };
};

export const savePortfolioState = async (state: PortfolioState): Promise<void> => {
  const payload = {
    id: STATE_ID,
    investments: state.investments,
    profile: state.profile,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from(TABLE)
    .upsert(payload, { onConflict: "id" });

  if (error) throw error;
};
