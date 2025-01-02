import { Injectable } from "@angular/core";

import { ApiService } from "@bitwarden/common/src/abstractions/api.service";
import { OrganizationId } from "@bitwarden/common/src/types/guid";
import { SecurityTaskStatus } from "@bitwarden/vault/src/tasks/enums";
import { SecurityTask } from "@bitwarden/vault/src/tasks/models";

import { AdminTaskService, CreateTasksRequest } from "./abstractions/admin-task.abstraction";

@Injectable()
export class DefaultAdminTaskService implements AdminTaskService {
  constructor(private apiService: ApiService) {}

  getAllTasks(
    organizationId: OrganizationId,
    status?: SecurityTaskStatus | undefined,
  ): Promise<SecurityTask[]> {
    throw new Error("Method not implemented.");
  }

  async bulkCreateTasks(
    organizationId: OrganizationId,
    tasks: CreateTasksRequest[],
  ): Promise<void> {
    await this.apiService.send("POST", `/tasks/${organizationId}/bulk-create`, tasks, true, true);
  }
}
