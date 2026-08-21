--
-- PostgreSQL database dump
--

\restrict F1inixZwfAGWhVwBcZhnsw5SOlVVhKrV6TFCGj4ljBIq9mRqvw99Vpg2DOquLaw

-- Dumped from database version 15.18
-- Dumped by pg_dump version 15.18

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: pg_trgm; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;


--
-- Name: EXTENSION pg_trgm; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION pg_trgm IS 'text similarity measurement and index searching based on trigrams';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: log_rollups; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.log_rollups (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    bucket_start timestamp with time zone NOT NULL,
    service character varying(255),
    level character varying(10),
    count integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.log_rollups OWNER TO postgres;

--
-- Name: logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.logs (
    id uuid DEFAULT public.uuid_generate_v4() NOT NULL,
    "timestamp" timestamp with time zone NOT NULL,
    level character varying(10) NOT NULL,
    service character varying(255) NOT NULL,
    message text NOT NULL,
    attributes jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT logs_level_check CHECK (((level)::text = ANY ((ARRAY['debug'::character varying, 'info'::character varying, 'warn'::character varying, 'error'::character varying])::text[])))
);


ALTER TABLE public.logs OWNER TO postgres;

--
-- Name: log_rollups log_rollups_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.log_rollups
    ADD CONSTRAINT log_rollups_pkey PRIMARY KEY (id);


--
-- Name: logs logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.logs
    ADD CONSTRAINT logs_pkey PRIMARY KEY (id);


--
-- Name: log_rollups uq_log_rollups_bucket_service_level; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.log_rollups
    ADD CONSTRAINT uq_log_rollups_bucket_service_level UNIQUE (bucket_start, service, level);


--
-- Name: idx_log_rollups_bucket; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_log_rollups_bucket ON public.log_rollups USING btree (bucket_start);


--
-- Name: idx_logs_message_trgm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_logs_message_trgm ON public.logs USING gin (message public.gin_trgm_ops);


--
-- Name: idx_logs_timestamp_desc; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_logs_timestamp_desc ON public.logs USING btree ("timestamp" DESC, id DESC);


--
-- Name: idx_logs_user_service_level_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_logs_user_service_level_time ON public.logs USING btree (((attributes ->> 'user_id'::text)), service, level, "timestamp" DESC, id DESC);


--
-- PostgreSQL database dump complete
--

\unrestrict F1inixZwfAGWhVwBcZhnsw5SOlVVhKrV6TFCGj4ljBIq9mRqvw99Vpg2DOquLaw

