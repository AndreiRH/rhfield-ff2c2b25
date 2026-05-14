
-- Enums
create type public.app_role as enum ('admin', 'engineer', 'pm');
create type public.chapter_kind as enum ('assembly', 'wiring', 'cold_comm', 'hot_comm', 'after_sales');
create type public.equipment_kind as enum ('kiln', 'shs', 'extra_work');

-- Profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- User roles
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  unique (user_id, role)
);
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create or replace function public.has_any_role(_user_id uuid, _roles app_role[])
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = any(_roles))
$$;

-- Auto-create profile + default engineer role on signup
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'display_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  values (new.id, 'engineer')
  on conflict do nothing;
  return new;
end;
$$;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Projects
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.projects enable row level security;

-- Lines
create table public.lines (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  number int not null,
  name text not null,
  hot_planned_start date,
  hot_planned_end date,
  created_at timestamptz not null default now(),
  unique (project_id, number)
);
alter table public.lines enable row level security;

-- Equipment groups (Kiln / SHS / extra_work)
create table public.equipment_groups (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.lines(id) on delete cascade,
  chapter chapter_kind not null,
  kind equipment_kind not null,
  name text not null,
  sort_order int not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.equipment_groups enable row level security;
create index on public.equipment_groups (line_id, chapter);

-- Components
create table public.components (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment_groups(id) on delete cascade,
  name text not null,
  sort_order int not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.components enable row level security;
create index on public.components (equipment_id);

-- Checklist items
create table public.checklist_items (
  id uuid primary key default gen_random_uuid(),
  component_id uuid not null references public.components(id) on delete cascade,
  label text not null,
  done boolean not null default false,
  note text,
  completed_by uuid references auth.users(id),
  completed_at timestamptz,
  sort_order int not null default 0,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.checklist_items enable row level security;
create index on public.checklist_items (component_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger checklist_items_touch before update on public.checklist_items
  for each row execute function public.touch_updated_at();

-- Item photos
create table public.item_photos (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references public.checklist_items(id) on delete cascade,
  storage_path text not null,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now()
);
alter table public.item_photos enable row level security;
create index on public.item_photos (item_id);

-- Hot commissioning milestones
create table public.milestones (
  id uuid primary key default gen_random_uuid(),
  line_id uuid not null references public.lines(id) on delete cascade,
  date date not null,
  label text not null,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);
alter table public.milestones enable row level security;
create index on public.milestones (line_id, date);

-- Common notes and files (per project)
create table public.common_notes (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  body text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id)
);
alter table public.common_notes enable row level security;
create unique index common_notes_project_uniq on public.common_notes (project_id);

create table public.common_files (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  storage_path text not null,
  size_bytes bigint,
  mime_type text,
  uploaded_by uuid references auth.users(id),
  uploaded_at timestamptz not null default now()
);
alter table public.common_files enable row level security;
create index on public.common_files (project_id);

-- ============ RLS POLICIES ============

-- Profiles: anyone signed-in can read; users edit their own
create policy "profiles read all signed-in" on public.profiles for select to authenticated using (true);
create policy "profiles update own" on public.profiles for update to authenticated using (id = auth.uid());
create policy "profiles insert own" on public.profiles for insert to authenticated with check (id = auth.uid());

-- user_roles: signed-in can read (so UI can decide), only admin can write
create policy "user_roles read" on public.user_roles for select to authenticated using (true);
create policy "user_roles admin write" on public.user_roles for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Helper: any team member (engineer, admin, pm) can read; engineer/admin can write
-- Projects
create policy "projects read team" on public.projects for select to authenticated
  using (public.has_any_role(auth.uid(), array['admin','engineer','pm']::app_role[]));
create policy "projects admin write" on public.projects for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

-- Lines
create policy "lines read team" on public.lines for select to authenticated
  using (public.has_any_role(auth.uid(), array['admin','engineer','pm']::app_role[]));
create policy "lines write engineer" on public.lines for insert to authenticated
  with check (public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]));
create policy "lines update engineer" on public.lines for update to authenticated
  using (public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]));
create policy "lines delete admin" on public.lines for delete to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- equipment_groups
create policy "eg read" on public.equipment_groups for select to authenticated
  using (public.has_any_role(auth.uid(), array['admin','engineer','pm']::app_role[]));
create policy "eg write" on public.equipment_groups for all to authenticated
  using (public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]))
  with check (public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]));

-- components
create policy "comp read" on public.components for select to authenticated
  using (public.has_any_role(auth.uid(), array['admin','engineer','pm']::app_role[]));
create policy "comp write" on public.components for all to authenticated
  using (public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]))
  with check (public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]));

-- checklist_items
create policy "ci read" on public.checklist_items for select to authenticated
  using (public.has_any_role(auth.uid(), array['admin','engineer','pm']::app_role[]));
create policy "ci write" on public.checklist_items for all to authenticated
  using (public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]))
  with check (public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]));

-- item_photos
create policy "ip read" on public.item_photos for select to authenticated
  using (public.has_any_role(auth.uid(), array['admin','engineer','pm']::app_role[]));
create policy "ip write" on public.item_photos for all to authenticated
  using (public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]))
  with check (public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]));

-- milestones
create policy "ms read" on public.milestones for select to authenticated
  using (public.has_any_role(auth.uid(), array['admin','engineer','pm']::app_role[]));
create policy "ms write" on public.milestones for all to authenticated
  using (public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]))
  with check (public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]));

-- common_notes
create policy "cn read" on public.common_notes for select to authenticated
  using (public.has_any_role(auth.uid(), array['admin','engineer','pm']::app_role[]));
create policy "cn write" on public.common_notes for all to authenticated
  using (public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]))
  with check (public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]));

-- common_files
create policy "cf read" on public.common_files for select to authenticated
  using (public.has_any_role(auth.uid(), array['admin','engineer','pm']::app_role[]));
create policy "cf write" on public.common_files for all to authenticated
  using (public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]))
  with check (public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]));

-- ============ STORAGE BUCKETS ============
insert into storage.buckets (id, name, public) values ('photos', 'photos', false) on conflict do nothing;
insert into storage.buckets (id, name, public) values ('files', 'files', false) on conflict do nothing;

create policy "storage photos read team" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and public.has_any_role(auth.uid(), array['admin','engineer','pm']::app_role[]));
create policy "storage photos write engineer" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]));
create policy "storage photos update engineer" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]));
create policy "storage photos delete engineer" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]));

create policy "storage files read team" on storage.objects for select to authenticated
  using (bucket_id = 'files' and public.has_any_role(auth.uid(), array['admin','engineer','pm']::app_role[]));
create policy "storage files write engineer" on storage.objects for insert to authenticated
  with check (bucket_id = 'files' and public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]));
create policy "storage files update engineer" on storage.objects for update to authenticated
  using (bucket_id = 'files' and public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]));
create policy "storage files delete engineer" on storage.objects for delete to authenticated
  using (bucket_id = 'files' and public.has_any_role(auth.uid(), array['admin','engineer']::app_role[]));

-- ============ SEED: BlueW1 with 10 lines + Kiln + SHS scaffolding ============
do $$
declare
  pid uuid;
  lid uuid;
  eg_kiln uuid;
  eg_shs uuid;
  comp_id uuid;
  i int;
  ch chapter_kind;
begin
  insert into public.projects (name) values ('BlueW1') returning id into pid;

  for i in 1..10 loop
    insert into public.lines (project_id, number, name)
    values (pid, i, 'Line ' || i)
    returning id into lid;

    foreach ch in array array['assembly','wiring','cold_comm','hot_comm']::chapter_kind[] loop
      insert into public.equipment_groups (line_id, chapter, kind, name, sort_order)
      values (lid, ch, 'kiln', 'Kiln', 0) returning id into eg_kiln;
      insert into public.equipment_groups (line_id, chapter, kind, name, sort_order)
      values (lid, ch, 'shs', 'SHS', 1) returning id into eg_shs;

      -- placeholder component + a couple of items so the UI has something to click
      insert into public.components (equipment_id, name, sort_order)
      values (eg_kiln, 'General', 0) returning id into comp_id;
      insert into public.checklist_items (component_id, label, sort_order)
      values (comp_id, 'Initial inspection', 0), (comp_id, 'Final check', 1);

      insert into public.components (equipment_id, name, sort_order)
      values (eg_shs, 'General', 0) returning id into comp_id;
      insert into public.checklist_items (component_id, label, sort_order)
      values (comp_id, 'Initial inspection', 0), (comp_id, 'Final check', 1);
    end loop;
  end loop;

  insert into public.common_notes (project_id, body) values (pid, '');
end $$;
