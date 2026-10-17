/**
 * Where a test lives. The Test Tool is one set of components for both
 * WSUSA (university tests at /admin/tests, admin.tests) and clubs
 * (/clubs/[slug]/manage/tests, the club's "tests" capability).
 */
export type TestScope =
  | { kind: "university"; clubId: null; basePath: string; ownerName: string; clubSlug: null }
  | { kind: "club"; clubId: string; basePath: string; ownerName: string; clubSlug: string };

export function universityScope(): TestScope {
  return { kind: "university", clubId: null, basePath: "/admin/tests", ownerName: "WSUSA", clubSlug: null };
}

export function clubScope(club: { id: string; slug: string; name: string }): TestScope {
  return { kind: "club", clubId: club.id, basePath: `/clubs/${club.slug}/manage/tests`, ownerName: club.name, clubSlug: club.slug };
}

export const scopeKind = (s: TestScope) => (s.kind === "club" ? "club" : "university") as "club" | "university";
