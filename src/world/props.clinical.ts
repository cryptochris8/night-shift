/**
 * Prop builders (clinical). Owned by the clinical props agent - see props.ts for the PropKit API.
 * The builders live in props.clinical.<part>.ts by family; this file only merges them.
 *
 * Conventions shared by every clinical builder:
 *   - floor props: origin at the floor centre of the footprint, bottom at y = 0;
 *   - surface items (terminal, microwave, coffee_maker): origin on the surface;
 *   - wall items (tv, sharps_bin, hand_sanitizer, mirror, monitor with mount 'arm'): origin on the
 *     wall surface at the item's vertical centre, protruding toward +z;
 *   - the front / usable / public side faces +z; furniture with a long axis runs along local x;
 *     beds, stretchers and carts run along local z with the head end at +z.
 */
import type { PropType } from '../core/types';
import type { PropBuilder } from './props';
import { APPLIANCE_BUILDERS } from './props.clinical.appliances';
import { BED_BUILDERS } from './props.clinical.beds';
import { CART_BUILDERS } from './props.clinical.carts';
import { CASEWORK_BUILDERS } from './props.clinical.casework';
import { CURTAIN_BUILDERS } from './props.clinical.curtain';
import { FIXTURE_BUILDERS } from './props.clinical.fixtures';
import { SCREEN_BUILDERS } from './props.clinical.screens';
import { SEATING_BUILDERS } from './props.clinical.seating';
import { STORAGE_BUILDERS } from './props.clinical.storage';
import { unifyShadows } from './props.clinical.common';

const ALL: Partial<Record<PropType, PropBuilder>> = {
  ...BED_BUILDERS,
  ...CART_BUILDERS,
  ...CURTAIN_BUILDERS,
  ...SCREEN_BUILDERS,
  ...SEATING_BUILDERS,
  ...CASEWORK_BUILDERS,
  ...STORAGE_BUILDERS,
  ...FIXTURE_BUILDERS,
  ...APPLIANCE_BUILDERS,
};

/** Every builder runs through unifyShadows so each material merges into a single draw call. */
export const CLINICAL_BUILDERS: Partial<Record<PropType, PropBuilder>> = Object.fromEntries(
  (Object.entries(ALL) as [PropType, PropBuilder][]).map(([type, build]): [PropType, PropBuilder] => [
    type,
    (k) => {
      build(k);
      unifyShadows(k);
    },
  ]),
);
