export const Roles = {
  ADMIN: "ADMIN",

  OWNER: "OWNER",

  OPERATOR: "OPERATOR",

  VIEWER: "VIEWER",
} as const;

export type Role =
  (typeof Roles)[keyof typeof Roles];