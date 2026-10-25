-- WC-TW-5a: hourly UTC offsets 2025-2028 for each zone in :'zones' (comma-separated), as zone,epoch,offset_minutes.
-- An unknown zone errors, so a zone Postgres lacks fails the job instead of being skipped.
\set ON_ERROR_STOP on
copy (
  select z,
         extract(epoch from t)::bigint,
         (extract(epoch from (t at time zone z) - (t at time zone 'UTC')) / 60)::int
  from unnest(string_to_array(:'zones', ',')) as z,
       generate_series('2025-01-01 00:00+00'::timestamptz, '2028-12-31 23:00+00'::timestamptz, interval '1 hour') as t
  order by 1, 2
) to stdout with (format csv);
