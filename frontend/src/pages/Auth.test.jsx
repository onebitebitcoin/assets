import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Login from "./Login.jsx";
import Signup from "./Signup.jsx";
import * as api from "../api.js";

vi.mock("../api.js", () => ({
  login: vi.fn(),
  register: vi.fn(),
  setToken: vi.fn()
}));

const renderWithRouter = (ui) => render(<MemoryRouter>{ui}</MemoryRouter>);

it("shows login error message when login fails", async () => {
  api.login.mockRejectedValueOnce(new Error("로그인 실패"));
  renderWithRouter(<Login />);

  fireEvent.change(screen.getByLabelText("사용자 이름"), { target: { value: "test" } });
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "test" } });
  fireEvent.click(screen.getByRole("button", { name: "로그인" }));

  expect(await screen.findByText("로그인 실패")).toBeInTheDocument();
});

it("shows signup error message when register fails", async () => {
  api.register.mockRejectedValueOnce(new Error("회원가입 실패"));
  renderWithRouter(<Signup />);

  fireEvent.change(screen.getByLabelText("사용자 이름"), { target: { value: "test" } });
  fireEvent.change(screen.getByLabelText("비밀번호"), { target: { value: "test" } });
  fireEvent.click(screen.getByRole("button", { name: "계정 만들기" }));

  expect(await screen.findByText("회원가입 실패")).toBeInTheDocument();
});
