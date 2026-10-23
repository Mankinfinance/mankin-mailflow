/**
 * Where LoanFlow lives. Mailflow is its own deployment and its root
 * redirects to the marketing dashboard, so "back to LoanFlow" has to
 * leave the app. NEXT_PUBLIC_LOANFLOW_URL overrides it if LoanFlow ever
 * moves to its own domain.
 */
export const LOANFLOW_URL =
  process.env.NEXT_PUBLIC_LOANFLOW_URL?.trim() || "https://mankin-followup.vercel.app";
