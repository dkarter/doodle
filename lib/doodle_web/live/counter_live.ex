defmodule DoodleWeb.CounterLive do
  use DoodleWeb, :live_view

  alias Doodle.Counters

  @impl true
  def mount(_params, _session, socket) do
    {:ok, counter} = Counters.get_or_create_counter()

    {:ok, assign(socket, :counter, counter)}
  end

  @impl true
  def handle_event("increment", _params, socket), do: update_counter(socket, 1)

  @impl true
  def handle_event("decrement", _params, socket), do: update_counter(socket, -1)

  defp update_counter(socket, delta) do
    case Counters.update_counter(socket.assigns.counter, delta) do
      {:ok, counter} ->
        {:noreply, assign(socket, :counter, counter)}

      {:error, _reason} ->
        {:noreply, put_flash(socket, :error, "Unable to update counter")}
    end
  end
end
