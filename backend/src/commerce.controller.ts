import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { Request } from 'express';
import { Permission } from './auth.guard';
import { CommerceService } from './commerce.service';

type AuthedRequest = Request & { user: { sub: string; username?: string; displayName?: string } };

@Controller('operations')
export class CommerceController {
  constructor(private readonly commerce: CommerceService) {}

  @Get('stores') @Permission('operations:view') stores() { return this.commerce.listStores(); }
  @Post('stores') @Permission('campaign:write') createStore(@Body() body: any) { return this.commerce.createStore(body); }
  @Patch('stores/:id') @Permission('campaign:write') updateStore(@Param('id') storeId: string, @Body() body: any) { return this.commerce.updateStore(storeId, body); }
  @Delete('stores/:id') @Permission('campaign:write') deleteStore(@Param('id') storeId: string) { return this.commerce.deleteStore(storeId); }

  @Get('campaigns') @Permission('operations:view') campaigns(@Query() query: any) { return this.commerce.listCampaigns(query); }
  @Get('campaigns/:id') @Permission('operations:view') campaign(@Param('id') id: string) { return this.commerce.getCampaign(id); }
  @Post('campaigns') @Permission('campaign:write') createCampaign(@Body() body: any) { return this.commerce.createCampaign(body); }
  @Patch('campaigns/:id') @Permission('campaign:write') editCampaign(@Param('id') id: string, @Body() body: any) { return this.commerce.editCampaign(id, body); }
  @Post('campaigns/:id/publish') @Permission('campaign:write') publishCampaign(@Param('id') id: string) { return this.commerce.setCampaignState(id, 'published'); }
  @Post('campaigns/:id/archive') @Permission('campaign:write') archiveCampaign(@Param('id') id: string) { return this.commerce.setCampaignState(id, 'archived'); }
  @Post('campaigns/:id/preview') @Permission('operations:view') previewCampaign(@Param('id') id: string, @Body() body: any) { return this.commerce.previewCampaign(id, body); }
  @Get('campaign-stats') @Permission('operations:view') campaignStats(@Query() query: any) { return this.commerce.campaignStats(query); }

  @Get('orders') @Permission('operations:view') orders(@Query() query: any) { return this.commerce.listOrders(query); }
  @Get('orders/:id') @Permission('operations:view') order(@Param('id') id: string) { return this.commerce.getOrder(id); }
  @Post('orders') @Permission('sales:write') createOrder(@Body() body: any, @Req() req: AuthedRequest) { return this.commerce.createOrder(body, req.user.sub); }
  @Post('orders/:id/cancel') @Permission('sales:write') cancelOrder(@Param('id') id: string, @Req() req: AuthedRequest) { return this.commerce.cancelOrder(id, { id: req.user.sub, username: req.user.username || '', displayName: req.user.displayName || '' }); }
  @Post('orders/:id/refunds') @Permission('sales:write') refundOrder(@Param('id') id: string, @Body() body: any, @Req() req: AuthedRequest) { return this.commerce.refundOrder(id, body, req.user.sub); }
  @Post('orders/:id/discounts') @Permission('sales:write') supplementOrderDiscounts(@Param('id') id: string, @Body() body: any, @Req() req: AuthedRequest) { return this.commerce.supplementOrderDiscounts(id, body, req.user.sub); }
}
