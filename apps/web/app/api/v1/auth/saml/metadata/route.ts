// R37 / A-2 — SP metadata endpoint.
//
// Hand the IdP an XML descriptor of our Service Provider (entity id, ACS URL,
// public cert, NameIDFormat). Most enterprise IdPs ingest this URL once at
// federation setup time and never call it again — keep the response cacheable
// (Cache-Control: public, max-age=3600).
//
// Public on purpose: SP metadata is non-sensitive (it only contains identifiers
// the IdP already has + our public cert). We still gate behind SAML_ENABLED so
// disabled deployments return 404 instead of advertising a half-configured SP.

import { NextResponse } from 'next/server';
import { getServiceProviderMetadata, isSamlEnabled } from '@/lib/saml';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  if (!isSamlEnabled()) {
    return new NextResponse('SAML not configured', { status: 404 });
  }

  try {
    const xml = getServiceProviderMetadata();
    return new NextResponse(xml, {
      status: 200,
      headers: {
        'Content-Type': 'application/xml; charset=utf-8',
        'Cache-Control': 'public, max-age=3600',
        'Content-Disposition': 'inline; filename="sp-metadata.xml"',
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[saml.metadata]', err);
    return new NextResponse('SAML metadata generation failed', { status: 500 });
  }
}
