defmodule Doodle.CountersTest do
  use Doodle.DataCase, async: true

  alias Doodle.Counters

  test "get_or_create_counter/0 creates and reuses the singleton counter" do
    assert {:ok, first_counter} = Counters.get_or_create_counter()
    assert {:ok, second_counter} = Counters.get_or_create_counter()

    assert first_counter.id == second_counter.id
    assert first_counter.value == 0
  end

  test "update_counter/2 persists increment and decrement" do
    assert {:ok, counter} = Counters.get_or_create_counter()
    assert {:ok, incremented_counter} = Counters.update_counter(counter, 1)
    assert incremented_counter.value == 1

    assert {:ok, decremented_counter} = Counters.update_counter(incremented_counter, -1)
    assert decremented_counter.value == 0
  end
end
