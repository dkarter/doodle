defmodule DoodleWeb.PageController do
  use DoodleWeb, :controller

  def home(conn, _params) do
    render(conn, :home)
  end
end
