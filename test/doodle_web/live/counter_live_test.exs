defmodule DoodleWeb.CounterLiveTest do
  use DoodleWeb.ConnCase, async: true

  import Phoenix.LiveViewTest

  alias Doodle.Counters

  test "counter buttons update UI and persistence", %{conn: conn} do
    {:ok, view, _html} = live(conn, ~p"/")

    assert has_element?(view, "#counter-value", "0")

    view
    |> element("#counter-up")
    |> render_click()

    assert has_element?(view, "#counter-value", "1")
    assert {:ok, counter} = Counters.get_or_create_counter()
    assert counter.value == 1

    view
    |> element("#counter-down")
    |> render_click()

    assert has_element?(view, "#counter-value", "0")
    assert {:ok, updated_counter} = Counters.get_or_create_counter()
    assert updated_counter.value == 0
  end
end
