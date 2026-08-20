import { Global, Module } from "@nestjs/common";
import { DatasetService } from "./dataset.service";

@Global()
@Module({
  providers: [DatasetService],
  exports: [DatasetService],
})
export class DatasetModule {}
