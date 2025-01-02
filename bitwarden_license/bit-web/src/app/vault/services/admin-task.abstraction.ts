import { OrganizationId } from "@bitwarden/common/src/types/guid";

export abstract class AdminTaskService {
  abstract getAllTasks(
    organizationId: OrganizationId,
    status?: "Pending" | "Completed",
  ): Promise<SecurityTask[]>;
}
