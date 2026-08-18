import { appSchema, tableSchema } from '@nozbe/watermelondb';

/**
 * Local (offline-first) schema.
 *
 * Mirrors the Postgres tables a stylist needs mid-shift with no signal — their
 * book, today's appointments, service menu, formulas, consents. Writes land
 * here first and sync as deltas on reconnect (Phase 6).
 *
 * Deliberately NOT mirrored:
 *   · payments            — money is server-authoritative; a device must never
 *                           be the source of truth for what was charged
 *   · booking_requests /
 *     negotiation_events  — deadline-driven and contested between two parties;
 *                           stale local state would show a slot as available
 *                           after someone else took it
 *   · feed / shop         — network content, cached opportunistically instead
 *   · formula_photos      — blobs belong in Storage, not SQLite
 *
 * Conventions:
 *   · `server_id` holds the Postgres UUID. Watermelon generates its own local
 *     ids, so the mapping has to be explicit.
 *   · Timestamps are unix millis (Watermelon's convention), converted at the
 *     sync boundary from Postgres timestamptz.
 *   · Every table carries `tenant_id` so the local database can be filtered
 *     the same way RLS filters the server, and so a departing stylist's rows
 *     can be dropped wholesale.
 */
export const schema = appSchema({
  version: 1,
  tables: [
    tableSchema({
      name: 'tenants',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'kind', type: 'string' },
        { name: 'name', type: 'string' },
        { name: 'parent_salon_id', type: 'string', isOptional: true },
        { name: 'timezone', type: 'string' },
      ],
    }),

    tableSchema({
      name: 'stylists',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'tenant_id', type: 'string', isIndexed: true },
        { name: 'full_name', type: 'string' },
        { name: 'avatar_url', type: 'string', isOptional: true },
        { name: 'role', type: 'string' },
        { name: 'classification', type: 'string', isOptional: true },
      ],
    }),

    tableSchema({
      name: 'clients',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'full_name', type: 'string' },
        { name: 'phone', type: 'string', isOptional: true },
        { name: 'email', type: 'string', isOptional: true },
      ],
    }),

    // The stylist's book. Tenant-scoped locally exactly as it is on the server.
    tableSchema({
      name: 'client_records',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'tenant_id', type: 'string', isIndexed: true },
        { name: 'client_id', type: 'string', isIndexed: true },
        { name: 'visit_count', type: 'number' },
        { name: 'no_show_count', type: 'number' },
        { name: 'safety_flag', type: 'string', isOptional: true },
        { name: 'requires_prepay', type: 'boolean' },
        { name: 'last_seen_at', type: 'number', isOptional: true },
      ],
    }),

    tableSchema({
      name: 'client_tags',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'tenant_id', type: 'string', isIndexed: true },
        { name: 'client_record_id', type: 'string', isIndexed: true },
        { name: 'tag', type: 'string' },
      ],
    }),

    tableSchema({
      name: 'services',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'tenant_id', type: 'string', isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'description', type: 'string', isOptional: true },
        { name: 'duration_minutes', type: 'number' },
        { name: 'price_cents', type: 'number' },
        { name: 'processing_window_minutes', type: 'number' },
        { name: 'processing_starts_after_minutes', type: 'number' },
        { name: 'requires_patch_test', type: 'boolean' },
        { name: 'is_active', type: 'boolean' },
        { name: 'sort_order', type: 'number' },
      ],
    }),

    tableSchema({
      name: 'appointments',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'tenant_id', type: 'string', isIndexed: true },
        { name: 'stylist_id', type: 'string', isIndexed: true },
        { name: 'client_id', type: 'string', isIndexed: true },
        { name: 'client_record_id', type: 'string', isIndexed: true },
        { name: 'starts_at', type: 'number', isIndexed: true },
        { name: 'ends_at', type: 'number' },
        { name: 'buffer_starts_at', type: 'number' },
        { name: 'buffer_ends_at', type: 'number' },
        { name: 'status', type: 'string', isIndexed: true },
        { name: 'is_for_child', type: 'boolean' },
        { name: 'child_first_name', type: 'string', isOptional: true },
        { name: 'child_age', type: 'number', isOptional: true },
        { name: 'arrived_at', type: 'number', isOptional: true },
        { name: 'service_started_at', type: 'number', isOptional: true },
        { name: 'service_ended_at', type: 'number', isOptional: true },
        { name: 'total_price_cents', type: 'number' },
      ],
    }),

    tableSchema({
      name: 'appointment_services',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'tenant_id', type: 'string', isIndexed: true },
        { name: 'appointment_id', type: 'string', isIndexed: true },
        { name: 'service_id', type: 'string', isIndexed: true },
        { name: 'price_cents', type: 'number' },
        { name: 'duration_minutes', type: 'number' },
        { name: 'processing_window_minutes', type: 'number' },
        { name: 'sort_order', type: 'number' },
      ],
    }),

    // Attached to the appointment, not just the client — so a child's colour
    // history cannot mix into the guardian's record.
    tableSchema({
      name: 'formulas',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'tenant_id', type: 'string', isIndexed: true },
        { name: 'appointment_id', type: 'string', isIndexed: true },
        { name: 'client_record_id', type: 'string', isIndexed: true },
        { name: 'components_json', type: 'string' },
        { name: 'developer_volume', type: 'string', isOptional: true },
        { name: 'processing_time_minutes', type: 'number', isOptional: true },
        { name: 'technique_notes', type: 'string', isOptional: true },
        { name: 'created_at', type: 'number' },
      ],
    }),

    tableSchema({
      name: 'consents',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'tenant_id', type: 'string', isIndexed: true },
        { name: 'client_record_id', type: 'string', isIndexed: true },
        { name: 'appointment_id', type: 'string', isOptional: true },
        { name: 'kind', type: 'string' },
        { name: 'product_tested', type: 'string', isOptional: true },
        { name: 'result', type: 'string', isOptional: true },
        { name: 'contraindications_disclosed', type: 'boolean', isOptional: true },
        { name: 'proceeded', type: 'boolean', isOptional: true },
        { name: 'signed_by_name', type: 'string' },
        { name: 'signed_by_guardian', type: 'boolean' },
        { name: 'document_version', type: 'string' },
        { name: 'signed_at', type: 'number' },
      ],
    }),

    tableSchema({
      name: 'business_hours',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'tenant_id', type: 'string', isIndexed: true },
        { name: 'weekday', type: 'number' },
        { name: 'opens_at', type: 'string' },
        { name: 'closes_at', type: 'string' },
      ],
    }),

    tableSchema({
      name: 'time_blocks',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'tenant_id', type: 'string', isIndexed: true },
        { name: 'starts_at', type: 'number', isIndexed: true },
        { name: 'ends_at', type: 'number' },
        { name: 'reason', type: 'string', isOptional: true },
      ],
    }),

    tableSchema({
      name: 'stylist_settings',
      columns: [
        { name: 'tenant_id', type: 'string', isIndexed: true },
        { name: 'requires_deposit', type: 'boolean' },
        { name: 'deposit_percent', type: 'number' },
        { name: 'deposit_min_cents', type: 'number' },
        { name: 'buffer_minutes', type: 'number' },
        { name: 'gap_buffer_minutes', type: 'number' },
        { name: 'arrival_note', type: 'string' },
        { name: 'free_cancel_hours', type: 'number' },
        { name: 'late_cancel_hours', type: 'number' },
        { name: 'no_show_grace_minutes', type: 'number' },
        { name: 'prepay_after_no_shows', type: 'number' },
        { name: 'redo_window_days', type: 'number' },
      ],
    }),

    tableSchema({
      name: 'inventory_items',
      columns: [
        { name: 'server_id', type: 'string', isIndexed: true },
        { name: 'tenant_id', type: 'string', isIndexed: true },
        { name: 'name', type: 'string' },
        { name: 'brand', type: 'string', isOptional: true },
        { name: 'kind', type: 'string' },
        { name: 'unit', type: 'string' },
        { name: 'quantity_on_hand', type: 'number' },
        { name: 'reorder_point', type: 'number', isOptional: true },
        { name: 'is_active', type: 'boolean' },
      ],
    }),
  ],
});
