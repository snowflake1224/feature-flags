import { Global, Module } from "@nestjs/common";
import { SdkAuthService } from "./sdk-auth.service";
import { AdminGuard } from "./admin.guard";
import { OwnershipService } from "./ownership.service";

@Global()
@Module({
  providers: [SdkAuthService, AdminGuard, OwnershipService],
  exports: [SdkAuthService, AdminGuard, OwnershipService],
})
export class CommonModule {}
