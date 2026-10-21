/**
 * Where a test lives. The Test Tool is one set of components for both
 * university tests (/admin/tests, admin.tests: WSUSA's, and each office's own,
 * Test.officeId) and clubs (/clubs/[slug]/manage/tests, the club's "tests"
 * capability). A university scope's `officeIds` is the offices whose tests it
 * shows; null for WSUSA's admins, who see every office's.
 */
export type TestScope =
  | { kind: "university"; clubId: null; basePath: string; ownerName: string; clubSlug: null; officeIds: string[] | null }
  | { kind: "club"; clubId: string; basePath: string; ownerName: string; clubSlug: string };

export function universityScope(opts: { officeIds: string[] | null; ownerName: string } = { officeIds: null, ownerName: "WSUSA" }): TestScope {
  return { kind: "university", clubId: null, basePath: "/admin/tests", ownerName: opts.ownerName, clubSlug: null, officeIds: opts.officeIds };
}

export function clubScope(club: { id: string; slug: string; name: string }): TestScope {
  return { kind: "club", clubId: club.id, basePath: `/clubs/${club.slug}/manage/tests`, ownerName: club.name, clubSlug: club.slug };
}

export const scopeKind = (s: TestScope) => (s.kind === "club" ? "club" : "university") as "club" | "university";
