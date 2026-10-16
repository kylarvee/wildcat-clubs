import type { ClubRole } from "@prisma/client";
import type { PickerPerson } from "@/components/roles/PersonPicker";
import type { CapabilityOption } from "@/components/roles/PermissionChecklist";
import type { RequirementLike } from "@/components/roles/RequirementList";

/** Serializable shapes the Org Chart page hands to its client pieces. */
export type SeatHolderInfo = { assignmentId: string; userId: string; name: string; role: ClubRole };

export type SeatInfo = {
  id: string;
  name: string;
  role: ClubRole;
  roleLabel: string;
  responsibilities: string[];
  defaultPermissions: string[];
  maxHolders: number;
  isCore: boolean;
  holders: SeatHolderInfo[];
};

export type ToolContext = {
  slug: string;
  clubId: string;
  clubName: string;
  capabilities: CapabilityOption[];
};

export type { PickerPerson, CapabilityOption, RequirementLike };
