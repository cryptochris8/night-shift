/** Prop builders (infra). Owned by the infra props agent — see props.ts for the PropKit API. */
import type { PropType } from '../core/types';
import type { PropBuilder } from './props';

export const INFRA_BUILDERS: Partial<Record<PropType, PropBuilder>> = {};
