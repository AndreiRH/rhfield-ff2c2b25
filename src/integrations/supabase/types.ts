export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      checklist_items: {
        Row: {
          completed_at: string | null
          completed_by: string | null
          component_id: string | null
          component_type_id: string | null
          created_at: string
          deleted_at: string | null
          done: boolean
          id: string
          label: string
          note: string | null
          note_shared: boolean
          parent_item_id: string | null
          sort_order: number
          template_id: string | null
          updated_at: string
        }
        Insert: {
          completed_at?: string | null
          completed_by?: string | null
          component_id?: string | null
          component_type_id?: string | null
          created_at?: string
          deleted_at?: string | null
          done?: boolean
          id?: string
          label: string
          note?: string | null
          note_shared?: boolean
          parent_item_id?: string | null
          sort_order?: number
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          completed_at?: string | null
          completed_by?: string | null
          component_id?: string | null
          component_type_id?: string | null
          created_at?: string
          deleted_at?: string | null
          done?: boolean
          id?: string
          label?: string
          note?: string | null
          note_shared?: boolean
          parent_item_id?: string | null
          sort_order?: number
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "checklist_items_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_items_component_type_id_fkey"
            columns: ["component_type_id"]
            isOneToOne: false
            referencedRelation: "component_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "checklist_items_parent_item_id_fkey"
            columns: ["parent_item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
        ]
      }
      common_files: {
        Row: {
          id: string
          mime_type: string | null
          name: string
          project_id: string
          size_bytes: number | null
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          id?: string
          mime_type?: string | null
          name: string
          project_id: string
          size_bytes?: number | null
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          id?: string
          mime_type?: string | null
          name?: string
          project_id?: string
          size_bytes?: number | null
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "common_files_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      common_folder_attachments: {
        Row: {
          file_name: string | null
          folder_id: string
          id: string
          kind: string
          sort_order: number
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          file_name?: string | null
          folder_id: string
          id?: string
          kind: string
          sort_order?: number
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          file_name?: string | null
          folder_id?: string
          id?: string
          kind?: string
          sort_order?: number
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "common_folder_attachments_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "common_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      common_folder_notes: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          file_name: string | null
          file_path: string | null
          folder_id: string
          id: string
          photo_path: string | null
          project_id: string
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          file_path?: string | null
          folder_id: string
          id?: string
          photo_path?: string | null
          project_id: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          file_path?: string | null
          folder_id?: string
          id?: string
          photo_path?: string | null
          project_id?: string
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "common_folder_notes_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "common_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      common_folders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
          parent_folder_id: string | null
          project_id: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          parent_folder_id?: string | null
          project_id: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
          parent_folder_id?: string | null
          project_id?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "common_folders_parent_folder_id_fkey"
            columns: ["parent_folder_id"]
            isOneToOne: false
            referencedRelation: "common_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      common_notes: {
        Row: {
          body: string
          id: string
          project_id: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          body?: string
          id?: string
          project_id: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          body?: string
          id?: string
          project_id?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "common_notes_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      component_files: {
        Row: {
          component_id: string
          file_name: string
          id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          component_id: string
          file_name: string
          id?: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          component_id?: string
          file_name?: string
          id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "component_files_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
        ]
      }
      component_photos: {
        Row: {
          component_id: string
          id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          component_id: string
          id?: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          component_id?: string
          id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "component_photos_component_id_fkey"
            columns: ["component_id"]
            isOneToOne: false
            referencedRelation: "components"
            referencedColumns: ["id"]
          },
        ]
      }
      component_types: {
        Row: {
          created_at: string
          deleted_at: string | null
          equipment_group_id: string
          id: string
          name: string
          sort_order: number
          template_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          equipment_group_id: string
          id?: string
          name: string
          sort_order?: number
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          equipment_group_id?: string
          id?: string
          name?: string
          sort_order?: number
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "component_types_equipment_group_id_fkey"
            columns: ["equipment_group_id"]
            isOneToOne: false
            referencedRelation: "equipment_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      components: {
        Row: {
          component_type_id: string | null
          created_at: string
          deleted_at: string | null
          equipment_id: string | null
          id: string
          name: string
          note: string | null
          note_shared: boolean
          sort_order: number
          template_id: string | null
        }
        Insert: {
          component_type_id?: string | null
          created_at?: string
          deleted_at?: string | null
          equipment_id?: string | null
          id?: string
          name: string
          note?: string | null
          note_shared?: boolean
          sort_order?: number
          template_id?: string | null
        }
        Update: {
          component_type_id?: string | null
          created_at?: string
          deleted_at?: string | null
          equipment_id?: string | null
          id?: string
          name?: string
          note?: string | null
          note_shared?: boolean
          sort_order?: number
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "components_component_type_id_fkey"
            columns: ["component_type_id"]
            isOneToOne: false
            referencedRelation: "component_types"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "components_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment_groups"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_groups: {
        Row: {
          chapter: Database["public"]["Enums"]["chapter_kind"]
          created_at: string
          deleted_at: string | null
          id: string
          kind: Database["public"]["Enums"]["equipment_kind"]
          line_id: string
          name: string
          plant_equipment_id: string | null
          sort_order: number
          template_id: string | null
        }
        Insert: {
          chapter: Database["public"]["Enums"]["chapter_kind"]
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["equipment_kind"]
          line_id: string
          name: string
          plant_equipment_id?: string | null
          sort_order?: number
          template_id?: string | null
        }
        Update: {
          chapter?: Database["public"]["Enums"]["chapter_kind"]
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["equipment_kind"]
          line_id?: string
          name?: string
          plant_equipment_id?: string | null
          sort_order?: number
          template_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_groups_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "equipment_groups_plant_equipment_id_fkey"
            columns: ["plant_equipment_id"]
            isOneToOne: false
            referencedRelation: "plant_equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_notes: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          equipment_id: string
          file_name: string | null
          file_path: string | null
          id: string
          is_shared: boolean
          photo_path: string | null
          position_x: number
          position_y: number
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          created_by?: string | null
          equipment_id: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          is_shared?: boolean
          photo_path?: string | null
          position_x?: number
          position_y?: number
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          equipment_id?: string
          file_name?: string | null
          file_path?: string | null
          id?: string
          is_shared?: boolean
          photo_path?: string | null
          position_x?: number
          position_y?: number
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      equipment_photos: {
        Row: {
          equipment_id: string
          id: string
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          equipment_id: string
          id?: string
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          equipment_id?: string
          id?: string
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "equipment_photos_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "plant_equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment_setting_groups: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          plant_equipment_id: string
          sort_order: number
          template_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          plant_equipment_id: string
          sort_order?: number
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          plant_equipment_id?: string
          sort_order?: number
          template_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      equipment_settings: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          deleted_at: string | null
          file_name: string | null
          file_path: string | null
          group_template_id: string | null
          id: string
          photo_path: string | null
          plant_equipment_id: string
          sort_order: number
          template_id: string | null
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          file_name?: string | null
          file_path?: string | null
          group_template_id?: string | null
          id?: string
          photo_path?: string | null
          plant_equipment_id: string
          sort_order?: number
          template_id?: string | null
          title?: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          file_name?: string | null
          file_path?: string | null
          group_template_id?: string | null
          id?: string
          photo_path?: string | null
          plant_equipment_id?: string
          sort_order?: number
          template_id?: string | null
          title?: string
          updated_at?: string
        }
        Relationships: []
      }
      item_files: {
        Row: {
          file_name: string
          id: string
          is_shared: boolean
          item_id: string
          origin_id: string | null
          origin_line_id: string | null
          storage_path: string
          template_id: string | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          file_name: string
          id?: string
          is_shared?: boolean
          item_id: string
          origin_id?: string | null
          origin_line_id?: string | null
          storage_path: string
          template_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          file_name?: string
          id?: string
          is_shared?: boolean
          item_id?: string
          origin_id?: string | null
          origin_line_id?: string | null
          storage_path?: string
          template_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_files_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
        ]
      }
      item_photos: {
        Row: {
          id: string
          is_shared: boolean
          item_id: string
          origin_id: string | null
          origin_line_id: string | null
          storage_path: string
          template_id: string | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          id?: string
          is_shared?: boolean
          item_id: string
          origin_id?: string | null
          origin_line_id?: string | null
          storage_path: string
          template_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          id?: string
          is_shared?: boolean
          item_id?: string
          origin_id?: string | null
          origin_line_id?: string | null
          storage_path?: string
          template_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "item_photos_item_id_fkey"
            columns: ["item_id"]
            isOneToOne: false
            referencedRelation: "checklist_items"
            referencedColumns: ["id"]
          },
        ]
      }
      lines: {
        Row: {
          created_at: string
          hot_planned_end: string | null
          hot_planned_start: string | null
          id: string
          name: string
          number: number
          project_id: string
        }
        Insert: {
          created_at?: string
          hot_planned_end?: string | null
          hot_planned_start?: string | null
          id?: string
          name: string
          number: number
          project_id: string
        }
        Update: {
          created_at?: string
          hot_planned_end?: string | null
          hot_planned_start?: string | null
          id?: string
          name?: string
          number?: number
          project_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "lines_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      milestones: {
        Row: {
          created_at: string
          created_by: string | null
          date: string
          id: string
          label: string
          line_id: string
          notes: string | null
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          date: string
          id?: string
          label: string
          line_id: string
          notes?: string | null
        }
        Update: {
          created_at?: string
          created_by?: string | null
          date?: string
          id?: string
          label?: string
          line_id?: string
          notes?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "milestones_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
        ]
      }
      pa_attachments: {
        Row: {
          file_name: string | null
          folder_id: string
          id: string
          kind: string
          sort_order: number
          storage_path: string
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          file_name?: string | null
          folder_id: string
          id?: string
          kind: string
          sort_order?: number
          storage_path: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          file_name?: string | null
          folder_id?: string
          id?: string
          kind?: string
          sort_order?: number
          storage_path?: string
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "pa_attachments_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "pa_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      pa_folders: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          kind: Database["public"]["Enums"]["plant_kind"]
          line_id: string
          name: string
          sort_order: number
          template_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind: Database["public"]["Enums"]["plant_kind"]
          line_id: string
          name?: string
          sort_order?: number
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["plant_kind"]
          line_id?: string
          name?: string
          sort_order?: number
          template_id?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      pa_notes: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          file_name: string | null
          file_path: string | null
          folder_id: string | null
          id: string
          is_shared: boolean
          kind: Database["public"]["Enums"]["plant_kind"]
          line_id: string
          photo_path: string | null
          sort_order: number
          title: string
          updated_at: string
        }
        Insert: {
          body?: string
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          file_path?: string | null
          folder_id?: string | null
          id?: string
          is_shared?: boolean
          kind: Database["public"]["Enums"]["plant_kind"]
          line_id: string
          photo_path?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          file_name?: string | null
          file_path?: string | null
          folder_id?: string | null
          id?: string
          is_shared?: boolean
          kind?: Database["public"]["Enums"]["plant_kind"]
          line_id?: string
          photo_path?: string | null
          sort_order?: number
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pa_notes_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "pa_folders"
            referencedColumns: ["id"]
          },
        ]
      }
      plant_equipment: {
        Row: {
          created_at: string
          deleted_at: string | null
          id: string
          kind: Database["public"]["Enums"]["equipment_kind"]
          line_id: string
          mech_manual_pct: number | null
          mech_mode: string
          mech_notes: string | null
          name: string
          sort_order: number
          template_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind: Database["public"]["Enums"]["equipment_kind"]
          line_id: string
          mech_manual_pct?: number | null
          mech_mode?: string
          mech_notes?: string | null
          name: string
          sort_order?: number
          template_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          deleted_at?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["equipment_kind"]
          line_id?: string
          mech_manual_pct?: number | null
          mech_mode?: string
          mech_notes?: string | null
          name?: string
          sort_order?: number
          template_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "plant_equipment_line_id_fkey"
            columns: ["line_id"]
            isOneToOne: false
            referencedRelation: "lines"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          display_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          display_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          display_name?: string | null
          id?: string
        }
        Relationships: []
      }
      projects: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      setting_files: {
        Row: {
          equipment_setting_id: string
          file_name: string
          id: string
          is_shared: boolean
          origin_id: string | null
          origin_line_id: string | null
          storage_path: string
          template_id: string | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          equipment_setting_id: string
          file_name: string
          id?: string
          is_shared?: boolean
          origin_id?: string | null
          origin_line_id?: string | null
          storage_path: string
          template_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          equipment_setting_id?: string
          file_name?: string
          id?: string
          is_shared?: boolean
          origin_id?: string | null
          origin_line_id?: string | null
          storage_path?: string
          template_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "setting_files_equipment_setting_id_fkey"
            columns: ["equipment_setting_id"]
            isOneToOne: false
            referencedRelation: "equipment_settings"
            referencedColumns: ["id"]
          },
        ]
      }
      setting_logs: {
        Row: {
          action: string
          created_at: string
          equipment_setting_id: string | null
          id: string
          new_value: string | null
          old_value: string | null
          plant_equipment_id: string
          setting_title: string
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string
          equipment_setting_id?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          plant_equipment_id: string
          setting_title?: string
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string
          equipment_setting_id?: string | null
          id?: string
          new_value?: string | null
          old_value?: string | null
          plant_equipment_id?: string
          setting_title?: string
          user_id?: string | null
        }
        Relationships: []
      }
      setting_photos: {
        Row: {
          equipment_setting_id: string
          id: string
          is_shared: boolean
          origin_id: string | null
          origin_line_id: string | null
          storage_path: string
          template_id: string | null
          uploaded_at: string
          uploaded_by: string | null
        }
        Insert: {
          equipment_setting_id: string
          id?: string
          is_shared?: boolean
          origin_id?: string | null
          origin_line_id?: string | null
          storage_path: string
          template_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Update: {
          equipment_setting_id?: string
          id?: string
          is_shared?: boolean
          origin_id?: string | null
          origin_line_id?: string | null
          storage_path?: string
          template_id?: string | null
          uploaded_at?: string
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "setting_photos_equipment_setting_id_fkey"
            columns: ["equipment_setting_id"]
            isOneToOne: false
            referencedRelation: "equipment_settings"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      admin_delete_user: { Args: { _user_id: string }; Returns: undefined }
      admin_list_users: {
        Args: never
        Returns: {
          created_at: string
          display_name: string
          email: string
          roles: Database["public"]["Enums"]["app_role"][]
          user_id: string
        }[]
      }
      admin_set_user_role: {
        Args: {
          _grant: boolean
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      checklist_item_line_id: { Args: { _item_id: string }; Returns: string }
      delete_project_cascade: {
        Args: { p_project_id: string }
        Returns: undefined
      }
      equipment_setting_line_id: {
        Args: { _setting_id: string }
        Returns: string
      }
      has_any_role: {
        Args: {
          _roles: Database["public"]["Enums"]["app_role"][]
          _user_id: string
        }
        Returns: boolean
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      import_project_bulk: { Args: { payload: Json }; Returns: undefined }
    }
    Enums: {
      app_role: "admin" | "engineer" | "pm"
      chapter_kind:
        | "assembly"
        | "wiring"
        | "cold_comm"
        | "hot_comm"
        | "after_sales"
      equipment_kind: "kiln" | "shs" | "extra_work"
      plant_kind: "kiln" | "shs"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "engineer", "pm"],
      chapter_kind: [
        "assembly",
        "wiring",
        "cold_comm",
        "hot_comm",
        "after_sales",
      ],
      equipment_kind: ["kiln", "shs", "extra_work"],
      plant_kind: ["kiln", "shs"],
    },
  },
} as const
