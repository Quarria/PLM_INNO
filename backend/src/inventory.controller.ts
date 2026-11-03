import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Permission } from './auth.guard';
import { InventoryService } from './inventory.service';

type AuthedRequest = Request & { user: { sub: string; username: string; displayName: string } };
const actor = (req: AuthedRequest) => ({ id: req.user.sub, username: req.user.username, displayName: req.user.displayName });

@Controller('operations')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Permission('operations:view') @Get('catalog') catalog(@Query() query: any) { return this.inventory.catalog(query); }
  @Permission('operations:view') @Get('warehouses') warehouses() { return this.inventory.warehouses(); }
  @Permission('operations:view') @Get('stock') stock(@Query() query: any) { return this.inventory.stock(query); }
  @Permission('operations:view') @Get('units') units(@Query() query: any) { return this.inventory.units(query); }
  @Permission('operations:view') @Get('movements') movements(@Query() query: any) { return this.inventory.movements(query); }
  @Permission('operations:view') @Get('trace') trace(@Query() query: any) { return this.inventory.trace(query); }

  @Permission('inventory:write') @Post('receipts') receipt(@Body() body: any, @Req() req: AuthedRequest) { return this.inventory.receipt(body, actor(req)); }
  @Permission('inventory:write') @Post('issues') issue(@Body() body: any, @Req() req: AuthedRequest) { return this.inventory.issue(body, actor(req)); }
  @Permission('inventory:write') @Post('reservations') reserve(@Body() body: any, @Req() req: AuthedRequest) { return this.inventory.reserve(body, actor(req)); }
  @Permission('inventory:write') @Post('releases') release(@Body() body: any, @Req() req: AuthedRequest) { return this.inventory.release(body, actor(req)); }
  @Permission('inventory:write') @Post('assemblies') assemble(@Body() body: any, @Req() req: AuthedRequest) { return this.inventory.assemble(body, actor(req)); }
  @Permission('inventory:write') @Post('bundle-components') bundleComponents(@Body() body: any, @Req() req: AuthedRequest) { return this.inventory.recordBundleComponents(body, actor(req)); }
  @Permission('inventory:write') @Post('disassemblies') disassemble(@Body() body: any, @Req() req: AuthedRequest) { return this.inventory.disassemble(body, actor(req)); }
  @Permission('inventory:write') @Post('inspections') inspect(@Body() body: any, @Req() req: AuthedRequest) { return this.inventory.inspect(body, actor(req)); }
}
