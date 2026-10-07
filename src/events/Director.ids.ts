/**
 * Canonical story ids shared with story/content.ts and events/interactables.ts (CONTRACT §4J).
 * Kept as string literals here so the director compiles and runs against the ids themselves,
 * independent of how content.ts shapes its FLAGS / CHOICES objects.
 */

export const F = {
  john_called: 'john_called',
  john_triaged: 'john_triaged',
  john_roomed: 'john_roomed',
  john_told_lights: 'john_told_lights',
  john_told_figure: 'john_told_figure',
  john_sedated: 'john_sedated',
  john_left_room: 'john_left_room',
  john_at_station: 'john_at_station',
  john_safe: 'john_safe',
  susie_believed: 'susie_believed',
  susie_checked_cctv: 'susie_checked_cctv',
  susie_went_alvarez: 'susie_went_alvarez',
  susie_went_john: 'susie_went_john',
  susie_held_position: 'susie_held_position',
  susie_investigated_elevator: 'susie_investigated_elevator',
  paul_has_flashlight: 'paul_has_flashlight',
  paul_reset_west_wing: 'paul_reset_west_wing',
  paul_restored_cctv: 'paul_restored_cctv',
  paul_restored_exam: 'paul_restored_exam',
  paul_entered_west_wing: 'paul_entered_west_wing',
  paul_shut_west_wing: 'paul_shut_west_wing',
  blackout_done: 'blackout_done',
  generator_on: 'generator_on',
  west_wing_door_open: 'west_wing_door_open',
  haddad_left: 'haddad_left',
  ambulance_left: 'ambulance_left',
  figure_seen_john: 'figure_seen_john',
  figure_cctv_frames: 'figure_cctv_frames',
} as const;

/** Director-private flags (never read by other modules; prefixed so they cannot collide). */
export const DF = {
  alvarez_man_said: 'dir_alvarez_man_said',
  john_call_light: 'dir_john_call_light',
  john_alone_since: 'dir_john_alone_since',
  john_hint_leave: 'dir_john_hint_leave',
  okafor_wandered: 'dir_okafor_wandered',
  paul_surge_done: 'dir_paul_surge_done',
  elevator_beat_done: 'dir_elevator_beat_done',
  john_missing_found: 'dir_john_missing_found',
  west_wing_laugh: 'dir_west_wing_laugh',
  relief_called: 'dir_relief_called',
  voltage_warned: 'dir_voltage_warned',
  believe_resolved: 'dir_believe_resolved',
  cams_hint: 'dir_cams_hint',
  kate_text_2: 'dir_kate_text_2',
  alvarez_alarm_live: 'dir_alvarez_alarm_live',
  john_closing_said: 'dir_john_closing_said',
  susie_closing_said: 'dir_susie_closing_said',
  paul_closing_said: 'dir_paul_closing_said',
  hall_figure_fired: 'dir_hall_figure_fired',
} as const;

export const C = {
  tell_lights: 'tell_lights',
  tell_figure: 'tell_figure',
  believe_john: 'believe_john',
  west_wing_breaker: 'west_wing_breaker',
  alvarez_or_john: 'alvarez_or_john',
  hold_or_investigate: 'hold_or_investigate',
  enter_west_wing: 'enter_west_wing',
} as const;

export const CLUE = {
  // rational
  hydrocodone: 'clue_hydrocodone',
  load_test: 'clue_load_test',
  roof_leak: 'clue_roof_leak',
  okafor_wander: 'clue_okafor_wander',
  voltage_log: 'clue_voltage_log',
  transfer_switch: 'clue_transfer_switch',
  // supernatural
  two_frames: 'clue_two_frames',
  footprints_out: 'clue_footprints_out',
  drag_marks: 'clue_drag_marks',
  west_wing_open: 'clue_west_wing_open',
  impossible_vitals: 'clue_impossible_vitals',
  timestamp_jump: 'clue_timestamp_jump',
  laughter: 'clue_laughter',
  // ambiguous
  alvarez_man: 'clue_alvarez_man',
  wheelchair: 'clue_wheelchair',
  elevator: 'clue_elevator',
  name_call: 'clue_name_call',
  cab_figure: 'clue_cab_figure',
} as const;

/** Difficulty → danger accrual multiplier (CONTRACT §4J). */
export const DANGER_SCALE = { easy: 0.6, normal: 1, hard: 1.5 } as const;
