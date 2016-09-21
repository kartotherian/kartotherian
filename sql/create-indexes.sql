--
-- Name: planet_osm_polygon_wikidata; Type: INDEX; Schema: public; Owner: osmimporter; Tablespace:
--

DO $$
BEGIN

IF NOT EXISTS (
    SELECT 1
    FROM   pg_class c
    JOIN   pg_namespace n ON n.oid = c.relnamespace
    WHERE  c.relname = 'planet_osm_polygon_wikidata'
    AND    n.nspname = 'public'
    ) THEN

    CREATE INDEX planet_osm_polygon_wikidata
      ON planet_osm_polygon ((tags -> 'wikidata'))
      WHERE tags ? 'wikidata';

END IF;

END$$;

--
-- Name: planet_osm_line_wikidata; Type: INDEX; Schema: public; Owner: osmimporter; Tablespace:
--

DO $$
BEGIN

IF NOT EXISTS (
    SELECT 1
    FROM   pg_class c
    JOIN   pg_namespace n ON n.oid = c.relnamespace
    WHERE  c.relname = 'planet_osm_line_wikidata'
    AND    n.nspname = 'public'
    ) THEN

    CREATE INDEX planet_osm_line_wikidata
      ON planet_osm_line ((tags -> 'wikidata'))
      WHERE tags ? 'wikidata';

END IF;

END$$;

--
-- Name: planet_osm_roads_wikidata; Type: INDEX; Schema: public; Owner: osmimporter; Tablespace:
--

DO $$
BEGIN

IF NOT EXISTS (
    SELECT 1
    FROM   pg_class c
    JOIN   pg_namespace n ON n.oid = c.relnamespace
    WHERE  c.relname = 'planet_osm_roads_wikidata'
    AND    n.nspname = 'public'
    ) THEN

    CREATE INDEX planet_osm_roads_wikidata
      ON planet_osm_roads ((tags -> 'wikidata'))
      WHERE tags ? 'wikidata';

END IF;

END$$;

