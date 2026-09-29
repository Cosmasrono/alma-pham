// Feature switches for parts of the system that are built but not shown yet.
// Safe on both the server and the client.

/** Multi-branch screens: the branch switcher, the dashboard's branch
 *  comparison, the Branches and Stock transfers pages, and branch columns.
 *  Off by default — the clinic runs as its single main branch and all the
 *  branch logic keeps working underneath. Turn on with this in .env (then
 *  restart):  NEXT_PUBLIC_ENABLE_BRANCHES=true */
export const BRANCHES_ENABLED = process.env.NEXT_PUBLIC_ENABLE_BRANCHES === "true";

/** Pages that only make sense with branches on — hidden from the menu. */
export const BRANCH_PAGES = ["/admin/branches", "/admin/transfers"];
