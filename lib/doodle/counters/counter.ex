defmodule Doodle.Counters.Counter do
  use Ecto.Schema
  import Ecto.Changeset

  schema "counters" do
    field :key, :string, default: "main"
    field :value, :integer, default: 0

    timestamps(type: :utc_datetime)
  end

  def changeset(counter, attrs) do
    counter
    |> cast(attrs, [:key, :value])
    |> validate_required([:key, :value])
    |> unique_constraint(:key)
  end
end
