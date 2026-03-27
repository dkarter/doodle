defmodule Doodle.Counters do
  import Ecto.Query, only: [from: 2]

  alias Doodle.Counters.Counter
  alias Doodle.Repo

  @counter_key "main"

  def get_or_create_counter do
    case Repo.one(from counter in Counter, where: counter.key == ^@counter_key, limit: 1) do
      nil -> create_counter()
      counter -> {:ok, counter}
    end
  end

  def update_counter(%Counter{} = counter, delta) when delta in [-1, 1] do
    counter
    |> Counter.changeset(%{value: counter.value + delta})
    |> Repo.update()
  end

  def update_counter(%Counter{}, _delta), do: {:error, :invalid_delta}

  defp create_counter do
    case %Counter{}
         |> Counter.changeset(%{key: @counter_key, value: 0})
         |> Repo.insert() do
      {:ok, counter} -> {:ok, counter}
      {:error, _changeset} -> {:ok, Repo.get_by!(Counter, key: @counter_key)}
    end
  end
end
