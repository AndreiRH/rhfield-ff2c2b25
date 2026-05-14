alter table public.checklist_items
  add column if not exists parent_item_id uuid references public.checklist_items(id) on delete cascade;

create index if not exists checklist_items_parent_idx on public.checklist_items(parent_item_id);