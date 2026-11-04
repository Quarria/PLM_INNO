import { Body, Controller, Get, Param, Patch, Post, Query, Req, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Request, Response } from 'express';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { Permission } from './auth.guard';
import { OpportunityService } from './opportunity.service';

type AuthedRequest = Request & { user: { sub: string; permissions?: string[] } };
const actor = (req: AuthedRequest) => ({ sub: req.user.sub, permissions: req.user.permissions || [] });
function normalizeUploadFilename(value: string): string {
  // Busboy may expose UTF-8 multipart bytes decoded as Latin-1. Already-
  // decoded Unicode stays untouched; valid Latin-1 names that are not UTF-8
  // fail the fatal decoder and also stay untouched.
  if (Array.from(value).some((char) => char.codePointAt(0)! > 0xff)) return value;
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(value, 'latin1'));
    return decoded && !/[\u0000-\u001f\u007f-\u009f]/.test(decoded) ? decoded : value;
  } catch { return value; }
}

@Controller('opportunities')
export class OpportunityController {
  constructor(private readonly opportunities: OpportunityService) {}
  @Get() list(@Query() query: any, @Req() req: AuthedRequest) { return this.opportunities.list(query, actor(req)); }
  @Get('options') options(@Query() query: any, @Req() req: AuthedRequest) { return this.opportunities.options(query, actor(req)); }
  @Get('owners') owners(@Req() req: AuthedRequest) { return this.opportunities.owners(actor(req)); }
  @Post() @Permission('opportunity:create') create(@Body() body: any, @Req() req: AuthedRequest) { return this.opportunities.create(body, actor(req)); }
  @Get(':id') async detail(@Param('id') id: string, @Req() req: AuthedRequest) { return this.opportunities.detail(id, actor(req)); }
  @Patch(':id') edit(@Param('id') id: string, @Body() body: any, @Req() req: AuthedRequest) { return this.opportunities.edit(id, body, actor(req)); }
  @Post(':id/advance') advance(@Param('id') id: string, @Body() body: any, @Req() req: AuthedRequest) { return this.opportunities.advance(id, body, actor(req)); }
  @Post(':id/return') returnStage(@Param('id') id: string, @Body() body: any, @Req() req: AuthedRequest) { return this.opportunities.returnStage(id, body, actor(req)); }
  @Post(':id/terminate') terminate(@Param('id') id: string, @Body() body: any, @Req() req: AuthedRequest) { return this.opportunities.terminate(id, body, actor(req)); }
  @Post(':id/transfer') transfer(@Param('id') id: string, @Body() body: any, @Req() req: AuthedRequest) { return this.opportunities.transfer(id, body, actor(req)); }
  @Post(':id/documents') document(@Param('id') id: string, @Body() body: any, @Req() req: AuthedRequest) { return this.opportunities.createDocument(id, body, actor(req)); }
  @Post(':id/documents/:documentId/void') voidDocument(@Param('id') id: string, @Param('documentId') documentId: string, @Body() body: any, @Req() req: AuthedRequest) { return this.opportunities.voidDocument(id, documentId, body, actor(req)); }
  @Post(':id/attachments') @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024, files: 1 } })) upload(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Req() req: AuthedRequest) { if(file)file.originalname=normalizeUploadFilename(file.originalname);return this.opportunities.saveAttachment(id, file, actor(req)); }
  @Get(':id/attachments/:attachmentId') async download(@Param('id') id: string, @Param('attachmentId') attachmentId: string, @Req() req: AuthedRequest, @Res() res: Response) {
    const { path, attachment } = await this.opportunities.attachment(id, attachmentId, actor(req));
    const safe = basename(attachment.file_name).replace(/[\r\n"\\]/g, '_');
    const fallback=safe.replace(/[^\x20-\x7E]/g,'_');
    res.setHeader('Content-Type', attachment.mime_type); res.setHeader('Content-Length', String(attachment.size)); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('Cache-Control','private, no-store');
    res.setHeader('Content-Disposition', `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(safe)}`);
    createReadStream(path).on('error', () => { if (!res.headersSent) res.status(404); res.end(); }).pipe(res);
  }
}
