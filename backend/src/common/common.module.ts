import { Global, Module } from "@nestjs/common";
import { SdkAuthService } from "./sdk-auth.service";
import { AdminGuard } from "./admin.guard";

@Global()
@Module({
  providers: [SdkAuthService, AdminGuard],
  exports: [SdkAuthService, AdminGuard],
})
export class CommonModule {}
