/**
 * Club Files end to end: the domain write path and the Google Drive mirror
 * (against an in-memory fake of the Drive API). It WRITES, so it only runs
 * against a throwaway copy of the database:
 *
 *   createdb wc_files_scratch && pg_dump --no-owner wildcat_clubs | psql -q wc_files_scratch
 *   DATABASE_URL=postgresql://…/wc_files_scratch FILES_SCRATCH_DB=1 npx vitest run src/lib/files/files.integration.test.ts
 *   dropdb wc_files_scratch
 *
 * Without both, it's skipped.
 */
import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";

// ─── A fake Drive API ────────────────────────────────────────────────────────
type FakeFile = { id: string; name: string; parents: string[]; trashed: boolean; perms: { id: string; type: string; role: string; emailAddress?: string }[] };
const store = new Map<string, FakeFile>();
let seq = 0;
const fakeDrive = {
  files: {
    create: vi.fn(async ({ requestBody }: { requestBody: { name: string; parents?: string[] } }) => {
      const id = `d${++seq}`;
      store.set(id, { id, name: requestBody.name, parents: requestBody.parents ?? [], trashed: false, perms: [{ id: "owner", type: "user", role: "owner", emailAddress: "club@weber.edu" }] });
      return { data: { id } };
    }),
    update: vi.fn(async ({ fileId, addParents, removeParents, requestBody }: { fileId: string; addParents?: string; removeParents?: string; requestBody?: { name?: string; trashed?: boolean } }) => {
      const f = store.get(fileId)!;
      if (requestBody?.name) f.name = requestBody.name;
      if (requestBody?.trashed !== undefined) f.trashed = requestBody.trashed;
      if (removeParents) f.parents = f.parents.filter((p) => !removeParents.split(",").includes(p));
      if (addParents && !f.parents.includes(addParents)) f.parents.push(addParents);
      return { data: { id: fileId } };
    }),
    get: vi.fn(async ({ fileId }: { fileId: string }) => ({ data: { parents: store.get(fileId)?.parents ?? [] } })),
    delete: vi.fn(async ({ fileId }: { fileId: string }) => {
      if (!store.delete(fileId)) throw Object.assign(new Error("not found"), { code: 404 });
      return {};
    }),
  },
  permissions: {
    list: vi.fn(async ({ fileId }: { fileId: string }) => ({ data: { permissions: store.get(fileId)?.perms ?? [] } })),
    create: vi.fn(async ({ fileId, requestBody }: { fileId: string; requestBody: { type: string; role: string; emailAddress?: string } }) => {
      store.get(fileId)!.perms.push({ id: `p${++seq}`, ...requestBody });
      return { data: {} };
    }),
    delete: vi.fn(async ({ fileId, permissionId }: { fileId: string; permissionId: string }) => {
      const f = store.get(fileId)!;
      f.perms = f.perms.filter((p) => p.id !== permissionId);
      return {};
    }),
    update: vi.fn(async ({ fileId, permissionId, requestBody }: { fileId: string; permissionId: string; requestBody: { role: string } }) => {
      store.get(fileId)!.perms.find((x) => x.id === permissionId)!.role = requestBody.role;
      return {};
    }),
  },
};
let driveOn = false;
vi.mock("@googleapis/drive", () => ({ drive: () => fakeDrive }));
vi.mock("@/lib/integrations/google", async (original) => ({ ...(await original<object>()), googleJwt: () => ({}) }));
vi.mock("@/lib/config", async (original) => ({ ...(await original<object>()), integrationLive: async (name: string) => driveOn && name === "googleDrive" }));

const RUN = process.env.FILES_SCRATCH_DB === "1" && /\/[^/?]*scratch[^/?]*(\?|$)/.test(process.env.DATABASE_URL ?? "");
const suite = RUN ? describe : describe.skip;

suite("Club Files (scratch database)", async () => {
  const { db } = await import("@/lib/db");
  const files = await import("@/lib/domain/files");
  const { STORAGE_ROOT } = await import("@/lib/files/storage");
  afterAll(() => db.$disconnect());

  const select = { id: true, email: true, name: true, handle: true, kind: true, platformRole: true, status: true, avatarColor: true, avatarUrl: true } as const;

  async function cast() {
    const club = await db.club.findFirstOrThrow({ where: { status: "APPROVED", roleAssignments: { some: { role: "ADVISOR", endedAt: null } } }, orderBy: { name: "asc" } });
    const role = (r: "ADVISOR" | "OFFICER") => db.roleAssignment.findFirstOrThrow({ where: { clubId: club.id, role: r, endedAt: null, user: { status: "ACTIVE" } }, select: { userId: true } });
    const [adv, off] = await Promise.all([role("ADVISOR"), role("OFFICER")]);
    const leaders = (await db.roleAssignment.findMany({ where: { clubId: club.id, endedAt: null }, select: { userId: true } })).map((r) => r.userId);
    const [advisor, officer, member, outsider, admin] = await Promise.all([
      db.user.findUniqueOrThrow({ where: { id: adv.userId }, select }),
      db.user.findUniqueOrThrow({ where: { id: off.userId }, select }),
      db.user.findFirstOrThrow({ where: { status: "ACTIVE", kind: "STUDENT", id: { notIn: leaders }, memberships: { some: { clubId: club.id, status: "ACTIVE" } } }, select }),
      db.user.findFirstOrThrow({ where: { status: "ACTIVE", kind: "STUDENT", platformRole: "USER", memberships: { none: { clubId: club.id } }, roleAssignments: { none: { clubId: club.id } } }, select }),
      db.user.findFirstOrThrow({ where: { platformRole: "ADMIN", status: "ACTIVE" }, select }),
    ]);
    return { club, advisor, officer, member, outsider, admin };
  }

  it("runs the whole file lifecycle with the right permissions", async () => {
    const { club, advisor, officer, member, outsider, admin } = await cast();
    const scope = { kind: "club" as const, clubId: club.id };
    const keys: string[] = [];

    await files.ensureClubFolders(club.id);
    expect((await files.ensureClubFolders(club.id)).created).toEqual([]);

    const asAdvisor = await files.listFolder(advisor, scope, null, { tree: true });
    expect(asAdvisor.canManage).toBe(true);
    expect((await files.listFolder(null, scope, null)).items.every((i) => i.effective === "PUBLIC")).toBe(true);
    expect((await files.listFolder(member, scope, null)).items.some((i) => i.effective === "LEADERS")).toBe(false);

    const folder = await files.createFolder(advisor, { scope, parentId: null, name: "Integration Test" });
    const sub = await files.createFolder(advisor, { scope, parentId: folder.id });
    expect(sub.name).toBe("New folder");
    const up = await files.uploadFile(advisor, { name: "hello.txt", bytes: Buffer.from("hello"), scope: "club", clubId: club.id, parentId: folder.id });
    const up2 = await files.uploadFile(advisor, { name: "hello.txt", bytes: Buffer.from("hi"), scope: "club", clubId: club.id, parentId: folder.id });
    keys.push(up.storageKey!, up2.storageKey!);
    expect(up2.name).toBe("hello (2).txt");
    await expect(files.uploadFile(advisor, { name: "x.txt", bytes: Buffer.from("x"), scope: "club", clubId: club.id, visibility: "EVERYONE" as never })).rejects.toThrow();
    await expect(files.uploadFile(member, { name: "m.txt", bytes: Buffer.from("m"), scope: "club", clubId: club.id, parentId: folder.id })).rejects.toThrow();
    await expect(files.renameItem(advisor, up2.id, "HELLO.txt")).rejects.toThrow(/already/);
    expect((await files.renameItem(advisor, up2.id, "second.txt")).name).toBe("second.txt");

    const row = () => db.fileItem.findUniqueOrThrow({ where: { id: up.id } });
    expect(await files.effectiveVisibility(await row())).toBe("MEMBERS");
    expect(await files.canViewFile(member, await row())).toBe(true);
    expect(await files.canViewFile(outsider, await row())).toBe(false);
    await files.setVisibility(advisor, folder.id, "LEADERS");
    expect(await files.canViewFile(member, await row())).toBe(false);
    expect(await files.canViewFile(officer, await row())).toBe(true);
    await expect(files.setVisibility(member, folder.id, "PUBLIC")).rejects.toThrow();

    // A grant on the folder reaches everything inside, and shows under "Shared with me".
    await files.grantAccess(advisor, folder.id, { userId: outsider.id, canEdit: false });
    expect(await files.canViewFile(outsider, await row())).toBe(true);
    expect(await files.canEditFile(outsider, await row())).toBe(false);
    expect((await files.browseFiles(outsider, { scope: { kind: "user", userId: outsider.id }, view: "shared" })).items.some((i) => i.id === folder.id)).toBe(true);
    expect((await files.browseFiles(outsider, { scope: "auto", parentId: folder.id })).items.length).toBe(3);
    await files.grantAccess(advisor, folder.id, { userId: outsider.id, canEdit: true });
    const guest = await files.uploadFile(outsider, { name: "guest.txt", bytes: Buffer.from("g"), scope: "club", clubId: club.id, parentId: folder.id });
    keys.push(guest.storageKey!);
    expect((await files.sharingInfo(advisor, folder.id)).grants).toHaveLength(1);
    await files.revokeAccess(advisor, folder.id, outsider.id);
    expect(await files.canViewFile(outsider, await row())).toBe(false);
    expect(await files.canViewFile(outsider, await db.fileItem.findUniqueOrThrow({ where: { id: guest.id } }))).toBe(true); // their own upload

    await files.setFeatured(advisor, up.id, true);
    await expect(files.setFeatured(advisor, folder.id, true)).rejects.toThrow();

    expect((await files.moveItems(advisor, [up.id], sub.id)).moved).toBe(1);
    await expect(files.moveItems(advisor, [folder.id], sub.id)).rejects.toThrow(/inside itself/);
    const dup = await files.uploadFile(advisor, { name: "hello.txt", bytes: Buffer.from("dup"), scope: "club", clubId: club.id, parentId: folder.id });
    keys.push(dup.storageKey!);
    expect((await files.moveItems(advisor, [dup.id], sub.id)).renamed[0]?.to).toBe("hello (2).txt");
    expect((await files.searchFiles(advisor, scope, "hello")).items.length).toBeGreaterThanOrEqual(2);

    // Trash takes a folder's contents along; the trash lists only what was trashed directly.
    await files.trashItems(advisor, [folder.id]);
    const trash = await files.browseFiles(advisor, { scope, view: "trash" });
    expect(trash.items.some((i) => i.id === folder.id) && !trash.items.some((i) => i.id === up.id)).toBe(true);
    await expect(files.browseFiles(member, { scope, view: "trash" })).rejects.toThrow();
    expect((await files.restoreItems(advisor, [folder.id])).restored).toBe(1);
    expect((await row()).trashedAt).toBeNull();
    await files.trashItems(advisor, [up2.id]);
    await files.trashItems(advisor, [folder.id]);
    expect((await files.restoreItems(advisor, [up2.id])).movedToTop).toEqual(["second.txt"]);

    await files.trashItems(advisor, [up2.id]);
    expect((await files.deleteForever(advisor, [folder.id, up2.id])).deleted).toBe(2);
    expect(await db.fileItem.count({ where: { id: { in: [folder.id, sub.id, up.id, up2.id, dup.id, guest.id] } } })).toBe(0);
    for (const k of keys) expect(existsSync(path.join(STORAGE_ROOT, k))).toBe(false);

    const doc = await db.clubDocument.findFirst({ where: { clubId: club.id, status: "ACTIVE", fileId: { not: null } }, select: { fileId: true } });
    if (doc?.fileId) await expect(files.trashItems(advisor, [doc.fileId])).rejects.toThrow(/can't be trashed/);

    // Personal files: MEMBERS = any signed-in account; LEADERS = only the owner.
    const mine = await files.createFolder(member, { scope: { kind: "user", userId: member.id }, name: "Portfolio" });
    const pf = await files.uploadFile(member, { name: "resume.pdf", bytes: Buffer.from("%PDF-1.4"), scope: "user", parentId: mine.id });
    const pfRow = () => db.fileItem.findUniqueOrThrow({ where: { id: pf.id } });
    expect(await files.canViewFile(outsider, await pfRow())).toBe(true);
    expect(await files.canViewFile(null, await pfRow())).toBe(false);
    await files.setVisibility(member, mine.id, "LEADERS");
    expect(await files.canViewFile(outsider, await pfRow())).toBe(false);
    await expect(files.browseFiles(outsider, { scope: { kind: "user", userId: member.id } })).rejects.toThrow();
    await files.trashItems(member, [mine.id]);
    expect((await files.emptyTrash(member, { kind: "user", userId: member.id })).deleted).toBe(1);

    await expect(files.browseFiles(member, { scope: { kind: "university" } })).rejects.toThrow();
    expect((await files.browseFiles(admin, { scope: { kind: "university" } })).canManage).toBe(true);
  }, 60_000);

  it("mirrors creates, renames, moves, sharing, trash and deletes to Drive", async () => {
    const { club, advisor, outsider } = await cast();
    driveOn = true;
    try {
      await db.club.update({ where: { id: club.id }, data: { contactEmail: "club@weber.edu", googleAccountVerifiedAt: new Date(), googleDriveFolderId: null } });
      await db.fileItem.updateMany({ where: { clubId: club.id }, data: { driveFileId: null } });
      const scope = { kind: "club" as const, clubId: club.id };

      const folder = await files.createFolder(advisor, { scope, parentId: null, name: "Drive Test" });
      const folderDrive = (await db.fileItem.findUniqueOrThrow({ where: { id: folder.id } })).driveFileId!;
      const rootId = (await db.club.findUniqueOrThrow({ where: { id: club.id } })).googleDriveFolderId!;
      expect(store.get(rootId)?.name).toContain(club.name);
      expect(store.get(rootId)!.perms.some((p) => p.role === "writer")).toBe(true); // leaders

      const up = await files.uploadFile(advisor, { name: "flyer.png", bytes: Buffer.from("png"), scope: "club", clubId: club.id, parentId: folder.id });
      const upDrive = (await db.fileItem.findUniqueOrThrow({ where: { id: up.id } })).driveFileId!;
      expect(store.get(upDrive)?.parents).toEqual([folderDrive]);

      await files.renameItem(advisor, up.id, "flyer-final.png");
      expect(store.get(upDrive)?.name).toBe("flyer-final.png");

      // PUBLIC folder: its files get a link; the folder itself never does.
      await files.setVisibility(advisor, folder.id, "PUBLIC");
      expect(store.get(upDrive)!.perms.some((p) => p.type === "anyone")).toBe(true);
      expect(store.get(folderDrive)!.perms.some((p) => p.type === "anyone")).toBe(false);
      await files.setVisibility(advisor, folder.id, "LEADERS");
      expect(store.get(upDrive)!.perms.some((p) => p.type === "anyone")).toBe(false);

      await files.grantAccess(advisor, up.id, { userId: outsider.id, canEdit: true });
      expect(store.get(upDrive)!.perms.some((p) => p.emailAddress === outsider.email && p.role === "writer")).toBe(true);
      await files.revokeAccess(advisor, up.id, outsider.id);
      expect(store.get(upDrive)!.perms.some((p) => p.emailAddress === outsider.email)).toBe(false);

      await files.moveItems(advisor, [up.id], null);
      expect(store.get(upDrive)?.parents).toEqual([rootId]);

      await files.trashItems(advisor, [folder.id, up.id]);
      expect(store.get(folderDrive)?.trashed).toBe(true);
      await files.restoreItems(advisor, [up.id]);
      expect(store.get(upDrive)?.trashed).toBe(false);
      await files.trashItems(advisor, [up.id]);
      await files.deleteForever(advisor, [folder.id, up.id]);
      expect(store.has(folderDrive) || store.has(upDrive)).toBe(false);

      const before = store.size;
      await files.prepareClubFiles(club.id);
      expect(store.size).toBeGreaterThan(before);
    } finally {
      driveOn = false;
    }
  }, 60_000);
});
