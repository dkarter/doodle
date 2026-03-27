defmodule Doodle.Repo.Migrations.CreateCounters do
  use Ecto.Migration

  def change do
    create table(:counters) do
      add :key, :string, null: false, default: "main"
      add :value, :integer, null: false, default: 0

      timestamps(type: :utc_datetime)
    end

    create unique_index(:counters, [:key])
  end
end
