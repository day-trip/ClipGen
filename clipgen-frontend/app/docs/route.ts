import { ApiReference } from '@scalar/nextjs-api-reference'
import { ApiReferenceConfiguration } from "@scalar/types";

const config: Partial<ApiReferenceConfiguration> = {
    url: '/openapi.yaml',
    hideClientButton: true,
    hideTestRequestButton: true
}

export const GET = ApiReference(config);