/**
 * Prop builders (infra): building services, power equipment, signage, storage, exterior and
 * devices. Each family lives in a props.infra.<part>.ts helper; this file only merges their maps.
 * See props.ts for the PropKit API and the placement conventions every builder follows:
 * floor props sit on y = 0 at the footprint centre, wall props start on the wall surface at their
 * vertical centre and protrude toward +z, overhead runs hang from their origin up to the ceiling.
 */
import type { PropType } from '../core/types';
import type { PropBuilder } from './props';
import { AMBULANCE_BUILDERS } from './props.infra.ambulance';
import { DEVICE_BUILDERS } from './props.infra.devices';
import { EXTERIOR_BUILDERS } from './props.infra.exterior';
import { GENERATOR_BUILDERS } from './props.infra.generator';
import { MECH_BUILDERS } from './props.infra.mech';
import { POWER_BUILDERS } from './props.infra.power';
import { STORAGE_BUILDERS } from './props.infra.storage';
import { WALL_BUILDERS } from './props.infra.wall';

export const INFRA_BUILDERS: Partial<Record<PropType, PropBuilder>> = {
  ...WALL_BUILDERS,
  ...POWER_BUILDERS,
  ...GENERATOR_BUILDERS,
  ...MECH_BUILDERS,
  ...STORAGE_BUILDERS,
  ...EXTERIOR_BUILDERS,
  ...AMBULANCE_BUILDERS,
  ...DEVICE_BUILDERS,
};
